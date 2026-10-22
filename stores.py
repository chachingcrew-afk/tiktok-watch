"""Stores (TikTok Shop sellers) of the women's clothing we track.

Every day the stores of our good women's products are visited. A store page shows the store's total
units sold and its best sellers (sorted by units sold). From two visits we know how much the whole
store sells per day; if that is far more than the products we already follow from it, the rest of its
best sellers are added to tracking ($30-70, 8000+ sold, no known brands). The usual rules
apply to them afterwards: measured every 6 hours, retired if they barely sell.
"""
from __future__ import annotations

import asyncio
import logging
import random
import re
import time

import db
import netstats
from core import brand_of
from fetch_product import _unescape
from fetch_video import HEADERS

log = logging.getLogger(__name__)

MIN_PRODUCT_PER_DAY = 40     # visit the stores of women's products selling at least this much a day (or starred)
REVISIT_HOURS = 20
MIN_PRODUCT_SOLD = 8000      # a store product must have sold this many in total to be added
MIN_PRICE, MAX_PRICE = 30, 70  # and cost this much (USD)
GAP_MIN_PER_DAY = 20         # explore again when the store sells this much more per day than we track ...
GAP_SHARE = 0.3              # ... and at least this share of the store's daily sales
CONCURRENCY = 6
BUDGET_S = 900


def parse_store(html: str) -> dict:
    t = _unescape(html)

    def f(p):
        m = re.search(p, t)
        return m.group(1) if m else None

    num = lambda s: int(s) if s and s.isdigit() else None  # noqa: E731
    try:
        rating = float(f(r'"shop_rating":\s*"([\d.]+)"') or "nan")
    except ValueError:
        rating = None
    return {
        "sold": num(f(r'"global_sold_count":\s*"?(\d+)')),
        "followers": num(f(r'"followers_count":\s*"?(\d+)')),
        "product_count": num(f(r'"on_sell_product_count":\s*"?(\d+)')),
        "rating": rating if rating == rating else None,
        "shop_name": f(r'"shop_name":\s*"((?:[^"\\]|\\.)*)"'),
        "url": (f(r'"shop_link":\s*"(https:(?:\\u002F|/)(?:\\u002F|/)shop\.tiktok\.com[^"]+)"') or "").replace("\\u002F", "/") or None,
    }


def fetch_store(url: str) -> str:
    """Direct from GitHub's IP only: a store page is over 1 MB, too much for the paid proxy."""
    last = None
    for attempt in range(2):
        if attempt:
            time.sleep(random.uniform(2, 4))
        try:
            r = netstats.get(url, headers={**HEADERS, "Accept-Language": "en-US,en;q=0.9"}, proxies=None, timeout=30)
            if r.status_code == 200 and "global_sold_count" in r.text:
                return r.text
            last = RuntimeError(f"HTTP {r.status_code}")
        except Exception as e:  # noqa: BLE001
            last = e
    raise last or RuntimeError("store fetch failed")


async def run(cfg, conn, stats) -> None:
    from shop import parse_category_page  # avoid a circular import at module load

    todo = db.stores_to_visit(conn, MIN_PRODUCT_PER_DAY, REVISIT_HOURS)
    stats["stores_selected"] = len(todo)
    if not todo:
        return
    tracked = db.tracked_per_seller(conn)
    gate = asyncio.Semaphore(CONCURRENCY)
    deadline = time.monotonic() + BUDGET_S

    async def one(seller_id, url):
        async with gate:
            if time.monotonic() > deadline:
                return seller_id, None
            await asyncio.sleep(random.uniform(0.2, 0.8))
            try:
                return seller_id, await asyncio.to_thread(fetch_store, url)
            except Exception as e:  # noqa: BLE001
                return seller_id, e

    urls = dict(todo)
    tasks = [asyncio.create_task(one(sid, url)) for sid, url in todo]
    for fut in asyncio.as_completed(tasks):
        seller_id, html = await fut
        if html is None:
            stats["stores_skipped"] += 1
            continue
        if isinstance(html, Exception):
            stats["store_errors"] += 1
            continue
        try:
            info = parse_store(html)
            info["url"] = info["url"] or urls.get(seller_id)
            if info["sold"] is None:
                stats["store_errors"] += 1
                continue
            state = db.save_store_visit(conn, seller_id, info, tracked.get(seller_id))
            stats["stores_visited"] += 1
            gap = (state["sold_per_day"] or 0) - (state["tracked_per_day"] or 0)
            explore = state["explored_at"] is None or (
                state["sold_per_day"] is not None and gap >= GAP_MIN_PER_DAY and gap >= GAP_SHARE * state["sold_per_day"])
            if explore:
                added = 0
                for p in parse_category_page(html):
                    if p["product_id"] in state["known"] or (p["sold"] or 0) < MIN_PRODUCT_SOLD:
                        continue
                    if p["price"] is None or not (MIN_PRICE <= p["price"] <= MAX_PRICE):
                        continue
                    if brand_of(p.get("title"), p.get("shop_name"), cfg.known_brands):
                        continue
                    p["focus"] = "women"
                    p["seller_id"] = p.get("seller_id") or seller_id
                    if not db.upsert_shop_product(conn, p):
                        continue  # retired and still not selling
                    if p["sold"] is not None:
                        db.add_product_snapshot(conn, p["product_id"], p["sold"], p["price"], p["price"], "listing")
                    added += 1
                db.mark_store_explored(conn, seller_id, added)
                stats["store_products_added"] += added
                stats["stores_explored"] += 1
            conn.commit()
        except Exception as e:  # noqa: BLE001
            conn.rollback()
            stats["store_errors"] += 1
            log.warning("Store %s: %s", seller_id, e)
