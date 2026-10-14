"""Daily: scan hashtag feeds (and trending) for fresh, fast-growing product videos and start tracking them."""
from __future__ import annotations

import asyncio
import logging
import os
import random
from collections import Counter
from datetime import datetime, timezone

import db
from core import Config, parse_video, passes_collect_filter, proxy_settings
from session import setup_logging, tiktok_session
from track import check_products

log = logging.getLogger("tiktok-watch")
STATS: Counter = Counter()  # also written to tiktok_watch.runs for the dashboard
FEEDS: dict = {}  # per-feed results (seen, new, error), stored with the run for troubleshooting


async def scan(api, source: str, iterator, cfg: Config, conn, known: set[str], stats: Counter) -> None:
    now = datetime.now(timezone.utc)
    feed = FEEDS.setdefault(source, {"seen": 0, "new": 0})
    try:
        async for video in iterator:
            stats["seen"] += 1
            feed["seen"] += 1
            parsed = parse_video(video.as_dict)
            if parsed is None:
                stats["unparsable"] += 1
                continue
            if parsed.video_id in known:
                stats["already_tracked"] += 1
                continue
            ok, reason = passes_collect_filter(parsed, cfg, now)
            stats[reason] += 1
            if not ok:
                continue
            db.upsert_video(conn, parsed, source)
            db.add_snapshot(conn, parsed.video_id, parsed.views, parsed.likes, parsed.comments,
                            parsed.shares, parsed.saves)
            conn.commit()
            known.add(parsed.video_id)
            feed["new"] += 1
            log.info("NEW %s | %s views | %s", parsed.url, f"{parsed.views:,}", parsed.description[:60])
    except Exception as e:  # one broken feed should not kill the whole run
        stats["feed_errors"] += 1
        feed["error"] = (type(e).__name__ + ": " + str(e))[:300]
        log.error("Feed %s failed after %d videos: %s", source, feed["seen"], e)


async def main() -> None:
    setup_logging()
    conn = db.connect()
    cfg = Config()
    applied = cfg.apply_overrides(db.load_settings(conn))
    log.info("Settings from dashboard: %s", ", ".join(applied) or "none")
    run_id = db.start_run(conn, "collect")
    try:
        await run(cfg, conn)
    except BaseException as e:
        db.finish_run(conn, run_id, False, {**STATS, "feeds": FEEDS}, str(e))
        raise
    db.finish_run(conn, run_id, True, {**STATS, "feeds": FEEDS})
    conn.close()


async def run(cfg: Config, conn) -> None:
    known = db.known_ids(conn)
    stats = STATS
    async with tiktok_session() as (api, _):
        if cfg.include_trending:
            await scan(api, "trending", api.trending.videos(count=cfg.trending_count), cfg, conn, known, stats)
        for tag in cfg.hashtags:
            await scan(api, f"#{tag}", api.hashtag(name=tag).videos(count=cfg.videos_per_hashtag),
                       cfg, conn, known, stats)
            await asyncio.sleep(random.uniform(3, 8))
    # Read price and units sold of the newly found products right away, instead of waiting for
    # the next 6-hourly tracking run (products already checked recently are skipped).
    try:
        _, req_proxy = proxy_settings(os.environ.get("PROXY_URL"))
        await check_products(cfg, conn, req_proxy, asyncio.Semaphore(4), stats)
    except Exception as e:  # prices are a bonus; never fail the collection over them
        log.warning("Product check failed: %s", e)

    log.info("Done. %s", dict(stats))
    if stats["seen"] == 0:
        raise SystemExit("No videos returned at all. TikTok is probably blocking: check PROXY_URL and MS_TOKEN.")


if __name__ == "__main__":
    asyncio.run(main())
