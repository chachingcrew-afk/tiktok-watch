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
import twins
from core import Config, brand_of, proxy_settings
from fetch_product import _unescape, fetch_product
from fetch_video import HEADERS
from session import setup_logging

log = logging.getLogger("tiktok-watch")
STATS: Counter = Counter()
CATS: dict = {}
CONCURRENCY = int(os.environ.get("SHOP_CONCURRENCY", "6"))
MAX_PRODUCT_PAGES = int(os.environ.get("SHOP_MAX_PRODUCT_PAGES", "800"))
PAGE_BUDGET_S = int(os.environ.get("SHOP_PAGE_BUDGET_S", "1200"))  # at most 20 minutes of product pages per run

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


def groups(cfg) -> list[dict]:
    """Category groups to scan: the general product categories, and women's clothing (more loads,
    own price band, known brands left out)."""
    g = [{"focus": None, "cats": cfg.shop_categories, "loads": cfg.shop_fetches_per_category,
          "lo": cfg.shop_min_price, "hi": cfg.shop_max_price, "skip_brands": False}]
    if cfg.fashion_categories:
        g.append({"focus": "women", "cats": cfg.fashion_categories, "loads": cfg.fashion_fetches_per_category,
                  "lo": cfg.fashion_min_price, "hi": cfg.fashion_max_price, "skip_brands": True})
    return g


async def scan_categories(cfg, conn, proxies) -> set[str]:
    gate = asyncio.Semaphore(CONCURRENCY)

    async def one(cat, n):
        async with gate:
            await asyncio.sleep(random.uniform(0.3, 1.5))
            url = f"https://shop.tiktok.com/us/c/{cat}" + (f"?page={n + 1}" if n else "")
            try:
                return cat, await asyncio.to_thread(fetch_category, url, proxies)
            except Exception as e:
                return cat, e

    kept: set[str] = set()
    brands = cfg.known_brands
    for g in groups(cfg):
        jobs = [(c, n) for c in g["cats"] for n in range(g["loads"])]
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
        ok = lambda p: p["price"] is not None and g["lo"] <= p["price"] <= g["hi"]  # noqa: E731
        prefix = "women_" if g["focus"] else ""
        for p in found.values():
            STATS[prefix + "seen"] += 1
            if not ok(p):
                STATS[prefix + "out_of_range"] += 1
                continue
            if g["skip_brands"] and brand_of(p.get("title"), p.get("shop_name"), brands):
                STATS[prefix + "brand_skipped"] += 1
                continue
            p["focus"] = g["focus"]
            if not db.upsert_shop_product(conn, p):
                STATS[prefix + "retired_skipped"] += 1  # barely sells: stays out until it picks up
                continue
            if p["sold"] is not None:
                db.add_product_snapshot(conn, p["product_id"], p["sold"], p["price"], p["price"], "listing")
            STATS[prefix + "in_range"] += 1
            kept.add(p["product_id"])
        for cat in g["cats"]:
            if cat in CATS:
                CATS[cat]["in_range"] = sum(1 for p in found.values() if p.get("category_id") == cat.split("/")[-1] and ok(p))
        conn.commit()
    return kept


async def refresh_missing(cfg, conn, proxies, seen_today: set[str]) -> None:
    """Read units sold from the product page of every promising product, listed today or not.

    The category listing's units-sold number lags behind the product page (often by days), so the
    daily sales of promising products always come from their product page. Pages are fetched from
    GitHub's own IP first, so this costs no proxy bandwidth.
    """
    await read_pages(conn, proxies, db.shop_products_to_refresh(conn, cfg.shop_track_min_sold)[:MAX_PRODUCT_PAGES])


async def read_pages(conn, proxies, todo: list[tuple[str, str]]) -> None:
    """Read units sold and price from each product page and store a 'page' snapshot."""
    if not todo:
        return
    gate = asyncio.Semaphore(CONCURRENCY)
    deadline = time.monotonic() + PAGE_BUDGET_S

    async def one(pid, url):
        async with gate:
            if time.monotonic() > deadline:
                return pid, None  # out of time for today; picked up first tomorrow
            await asyncio.sleep(random.uniform(0.2, 0.8))
            try:
                return pid, await asyncio.to_thread(fetch_product, url, pid, proxies, 2, 20)
            except Exception as e:
                return pid, e

    # save each page as soon as it arrives, so a slow or interrupted run keeps what it read
    # Create the tasks in list order (as_completed would shuffle bare coroutines through a set), so the
    # semaphore hands out slots in priority order: starred and fast sellers first, before the time budget runs out.
    tasks = [asyncio.create_task(one(pid, url)) for pid, url in todo]
    for fut in asyncio.as_completed(tasks):
        pid, info = await fut
        if info is None:
            STATS["product_pages_skipped"] += 1
            continue
        if isinstance(info, Exception):
            STATS["product_page_errors"] += 1
            db.touch_shop_product(conn, pid)
        else:
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
        STATS["retired"] += db.retire_slow(conn)
        try:
            await asyncio.to_thread(gallery.run, conn, cfg.shop_track_min_sold, proxies, STATS)
        except Exception as e:  # images are a convenience; never fail the scan because of them
            conn.rollback()
            STATS["gallery_failed"] += 1
            log.warning("Gallery step failed: %s", e)
        try:
            await asyncio.to_thread(twins.run, conn, STATS)
        except Exception as e:  # a hint for the dashboard; never fail the scan because of it
            conn.rollback()
            STATS["twins_failed"] += 1
            log.warning("Same-product step failed: %s", e)
    except BaseException as e:
        db.finish_run(conn, run_id, False, {**STATS, **netstats.summary(), "categories": CATS}, str(e))
        raise
    log.info("Done. %s", dict(STATS))
    ok = STATS["seen"] + STATS["women_seen"] > 0
    db.finish_run(conn, run_id, ok, {**STATS, **netstats.summary(), "categories": CATS}, None if ok else "no products found in any category")
    conn.close()
    if not ok:
        raise SystemExit("No products found. TikTok Shop may be blocking the category pages.")


if __name__ == "__main__":
    asyncio.run(main())
