"""Daily TikTok Shop category scan: find products in the price range and record units sold.

shop.tiktok.com/us/c/<slug>/<id> pages list ~20 products each, with price and units sold, and
every load returns a somewhat different selection, so each category is loaded a few times.
Products are saved to tiktok_watch.shop_products and their units sold to product_snapshots;
the shop_product_scores view turns consecutive days into units sold per day and revenue per day.

Known products that did not show up in today's listings are re-read from their product page
(limited per day), so their daily sales stay continuous.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import re
import time
from collections import Counter

import requests

import db
import netstats
import gallery
from core import Config, proxy_settings
from fetch_product import _unescape, fetch_product
from fetch_video import HEADERS
from session import setup_logging

log = logging.getLogger("tiktok-watch")
STATS: Counter = Counter()
CATS: dict = {}
CONCURRENCY = int(os.environ.get("SHOP_CONCURRENCY", "4"))
MAX_PRODUCT_PAGES = int(os.environ.get("SHOP_MAX_PRODUCT_PAGES", "800"))

PRODUCT_START = re.compile(r'\{"product_id":\s*"(\d{15,20})",\s*"title":\s*"')


def _jstr(raw: str) -> str:
    try:
        return json.loads('"' + raw + '"')
    except ValueError:
        return raw


def _f(pattern: str, chunk: str):
    m = re.search(pattern, chunk)
    return m.group(1) if m else None


def _num(s):
    try:
        return float(s) if s is not None else None
    except ValueError:
        return None


def parse_category_page(html: str) -> list[dict]:
    """Return the products listed on a category page."""
    text = _unescape(html)
    starts = list(PRODUCT_START.finditer(text))
    out, seen = [], set()
    for i, m in enumerate(starts):
        pid = m.group(1)
        if pid in seen:
            continue
        end = starts[i + 1].start() if i + 1 < len(starts) else min(len(text), m.start() + 6000)
        chunk = text[m.start():end]
        # the page is un-escaped, so a quote inside the title (10.5" screen) is a bare quote;
        # read up to the next known field instead of the next quote
        title = _f(r'"title":\s*"(.*?)",\s*"(?:image|product_price_info|rate_info|sold_info|seller_info)"', chunk) \
            or _f(r'"title":\s*"((?:[^"\\]|\\.)*)"', chunk)
        price = _num(_f(r'"sale_price_decimal":\s*"([\d.]+)"', chunk))
        if price is None:
            continue
        seen.add(pid)
        img = _f(r'"url_list":\s*\[\s*"([^"]+)"', chunk)
        url = _f(r'"canonical_url":\s*"([^"]+)"', chunk)
        out.append({
            "product_id": pid,
            "title": _jstr(title)[:500] if title else None,
            "price": price,
            "price_original": _num(_f(r'"raw_origin_price_decimal":\s*"([\d.]+)"', chunk)),
            "sold": int(sold) if (sold := _f(r'"sold_count":\s*"?(\d+)', chunk)) else None,
            "rating": _num(_f(r'"score":\s*([\d.]+)', chunk)),
            "reviews": int(rc) if (rc := _f(r'"review_count":\s*"?(\d+)', chunk)) else None,
            "shop_name": _jstr(_f(r'"shop_name":\s*"((?:[^"\\]|\\.)*)"', chunk) or "") or None,
            "seller_id": _f(r'"seller_id":\s*"(\d+)"', chunk),
            "image": _jstr(img) if img else None,
            "url": _jstr(url) if url else f"https://shop.tiktok.com/view/product/{pid}?region=US",
        })
    return out


def category_name(html: str) -> str | None:
    text = _unescape(html)
    m = re.search(r'"self":\s*\{[^{}]*"category_name":\s*"([^"]+)"', text)
    return _jstr(m.group(1)) if m else None


def fetch_category(url: str, proxies: dict | None, attempts: int = 2) -> str:
    """Plain GET; on failure, try once more through the proxy if one is configured."""
    last = None
    for attempt in range(attempts):
        if attempt:
            time.sleep(random.uniform(2, 4))
        try:
            # first try GitHub's own IP (free), then the proxy
            r = netstats.get(url, headers=HEADERS, proxies=proxies if attempt else None, timeout=30)
            if r.status_code == 200 and "productList" in r.text:
                return r.text
            last = RuntimeError(f"HTTP {r.status_code}, no product list")
        except requests.RequestException as e:
            last = e
    raise last or RuntimeError("fetch failed")


def in_range(p: dict, cfg) -> bool:
    return p["price"] is not None and cfg.shop_min_price <= p["price"] <= cfg.shop_max_price


async def scan_categories(cfg, conn, proxies) -> set[str]:
    gate = asyncio.Semaphore(CONCURRENCY)
    jobs = [(c, n) for c in cfg.shop_categories for n in range(cfg.shop_fetches_per_category)]

    async def one(cat, n):
        async with gate:
            await asyncio.sleep(random.uniform(0.3, 1.5))
            url = f"https://shop.tiktok.com/us/c/{cat}" + (f"?page={n + 1}" if n else "")
            try:
                return cat, await asyncio.to_thread(fetch_category, url, proxies)
            except Exception as e:
                return cat, e

    found: dict[str, dict] = {}
    for cat, res in await asyncio.gather(*(one(c, n) for c, n in jobs)):
        info = CATS.setdefault(cat, {"loads": 0, "products": 0, "in_range": 0})
        if isinstance(res, Exception):
            info["error"] = (type(res).__name__ + ": " + str(res))[:200]
            STATS["category_errors"] += 1
            continue
        info["loads"] += 1
        name = category_name(res) or cat.split("/")[0].replace("-", " ").title()
        for p in parse_category_page(res):
            info["products"] += 1
            if p["product_id"] in found:
                continue
            p["category_id"], p["category_name"] = cat.split("/")[-1], name
            found[p["product_id"]] = p
    for p in found.values():
        STATS["seen"] += 1
        if not in_range(p, cfg):
            STATS["out_of_range"] += 1
            continue
        db.upsert_shop_product(conn, p)
        if p["sold"] is not None:
            db.add_product_snapshot(conn, p["product_id"], p["sold"], p["price"], p["price"], "listing")
        STATS["in_range"] += 1
    for cat in cfg.shop_categories:
        if cat in CATS:
            CATS[cat]["in_range"] = sum(1 for p in found.values() if p.get("category_id") == cat.split("/")[-1] and in_range(p, cfg))
    conn.commit()
    return {pid for pid, p in found.items() if in_range(p, cfg)}


async def refresh_missing(cfg, conn, proxies, seen_today: set[str]) -> None:
    """Read units sold from the product page of every promising product, listed today or not.

    The category listing's units-sold number lags behind the product page (often by days), so the
    daily sales of promising products always come from their product page. Pages are fetched from
    GitHub's own IP first, so this costs no proxy bandwidth.
    """
    todo = db.shop_products_to_refresh(conn, cfg.shop_track_min_sold)[:MAX_PRODUCT_PAGES]
    if not todo:
        return
    gate = asyncio.Semaphore(CONCURRENCY)

    async def one(pid, url):
        async with gate:
            await asyncio.sleep(random.uniform(0.3, 1.5))
            try:
                return await asyncio.to_thread(fetch_product, url, pid, proxies, 2)
            except Exception as e:
                return e

    for (pid, url), info in zip(todo, await asyncio.gather(*(one(pid, url) for pid, url in todo))):
        if isinstance(info, Exception):
            STATS["product_page_errors"] += 1
            db.touch_shop_product(conn, pid)
            continue
        db.save_shop_product_page(conn, pid, info)
        if info.get("sold") is not None:
            db.add_product_snapshot(conn, pid, info["sold"], info.get("price_min"), info.get("price_max"), "page")
        STATS["product_pages"] += 1
    conn.commit()


async def main() -> None:
    setup_logging()
    conn = db.connect()
    cfg = Config()
    cfg.apply_overrides(db.load_settings(conn))
    run_id = db.start_run(conn, "shop")
    _, proxies = proxy_settings(os.environ.get("PROXY_URL"))
    try:
        seen = await scan_categories(cfg, conn, proxies)
        await refresh_missing(cfg, conn, proxies, seen)
        try:
            await asyncio.to_thread(gallery.run, conn, cfg.shop_track_min_sold, proxies, STATS)
        except Exception as e:  # images are a convenience; never fail the scan because of them
            conn.rollback()
            STATS["gallery_failed"] += 1
            log.warning("Gallery step failed: %s", e)
    except BaseException as e:
        db.finish_run(conn, run_id, False, {**STATS, **netstats.summary(), "categories": CATS}, str(e))
        raise
    log.info("Done. %s", dict(STATS))
    ok = STATS["seen"] > 0
    db.finish_run(conn, run_id, ok, {**STATS, **netstats.summary(), "categories": CATS}, None if ok else "no products found in any category")
    conn.close()
    if not ok:
        raise SystemExit("No products found. TikTok Shop may be blocking the category pages.")


if __name__ == "__main__":
    asyncio.run(main())
