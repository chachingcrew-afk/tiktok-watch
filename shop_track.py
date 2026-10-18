"""6-hourly sales check of every TikTok Shop product in the price band (and starred ones).

The daily shop scan (shop.py) finds products and reads every promising product page once a day.
Between those runs this job re-reads the product pages of all of them, starred and fastest
sellers first, so every sales curve has a point every 6 hours. Pages are fetched from
GitHub's own IP first, so this normally costs no proxy bandwidth.
"""
from __future__ import annotations

import asyncio
import logging
import os

import db
import netstats
import shop
from core import Config, proxy_settings
from session import setup_logging

log = logging.getLogger("tiktok-watch")
LIMIT = int(os.environ.get("SHOP_6H_LIMIT", "3000"))


async def main() -> None:
    setup_logging()
    conn = db.connect()
    cfg = Config()
    cfg.apply_overrides(db.load_settings(conn))
    run_id = db.start_run(conn, "shop_track")
    _, proxies = proxy_settings(os.environ.get("PROXY_URL"))
    try:
        todo = db.shop_products_6h(conn, cfg.shop_min_price, cfg.shop_max_price, LIMIT, cfg.fashion_min_price, cfg.fashion_max_price)
        shop.STATS["selected"] = len(todo)
        await shop.read_pages(conn, proxies, todo)
    except BaseException as e:
        db.finish_run(conn, run_id, False, {**shop.STATS, **netstats.summary()}, str(e))
        raise
    db.finish_run(conn, run_id, True, {**shop.STATS, **netstats.summary()})
    log.info("Done. %s", dict(shop.STATS))
    conn.close()


if __name__ == "__main__":
    asyncio.run(main())
