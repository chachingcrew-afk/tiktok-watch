"""Every 6 hours: re-check every tracked video, store a snapshot and drop the ones that slowed down or got too old."""
from __future__ import annotations

import asyncio
import logging
import os
import random
from collections import Counter
from datetime import datetime, timezone

import db
from core import Config, parse_video, proxy_settings, tracking_decision
from fetch_video import fetch_video
from session import setup_logging

log = logging.getLogger("tiktok-watch")
STATS: Counter = Counter()  # also written to tiktok_watch.runs for the dashboard
CONCURRENCY = int(os.environ.get("TRACK_CONCURRENCY", "4"))


async def main() -> None:
    setup_logging()
    conn = db.connect()
    cfg = Config()
    applied = cfg.apply_overrides(db.load_settings(conn))
    log.info("Settings from dashboard: %s", ", ".join(applied) or "none")
    run_id = db.start_run(conn, "track")
    try:
        await run(cfg, conn)
    except BaseException as e:
        db.finish_run(conn, run_id, False, dict(STATS), str(e))
        raise
    db.finish_run(conn, run_id, True, dict(STATS))
    conn.close()


async def run(cfg: Config, conn) -> None:
    videos = db.tracking_videos(conn)
    log.info("Re-checking %d tracked videos", len(videos))
    stats = STATS
    now = datetime.now(timezone.utc)

    # No browser here: each video page is fetched directly through the proxy (see fetch_video.py),
    # so one slow page can only fail that one video, never the whole run.
    _, req_proxy = proxy_settings(os.environ.get("PROXY_URL"))
    if not req_proxy:
        log.warning("No PROXY_URL set. From a server TikTok will very likely block requests.")

    # Too-old videos are expired without a network call.
    active = []
    for video_id, url, created_at, _fails, starred in videos:
        if (now - created_at).total_seconds() > cfg.max_age_days * 86400:
            db.set_status(conn, video_id, "expired")
            conn.commit()
            stats["expired"] += 1
        else:
            active.append((video_id, url, created_at, starred))

    # Fetch a few pages at a time (each request goes out through its own proxy IP);
    # database writes stay sequential on this one connection.
    gate = asyncio.Semaphore(CONCURRENCY)

    async def fetch(video_id, url):
        async with gate:
            await asyncio.sleep(random.uniform(0.2, 1.5))
            try:
                data = await asyncio.to_thread(fetch_video, url, video_id, req_proxy)
                parsed = parse_video(data)
                return parsed if parsed is not None else ValueError("unparsable response")
            except Exception as e:
                return e

    results = await asyncio.gather(*(fetch(v[0], v[1]) for v in active))

    for (video_id, url, created_at, starred), parsed in zip(active, results):
        if isinstance(parsed, Exception):
            log.warning("Fetch failed for %s: %s", url, parsed)
            db.mark_failed(conn, video_id, cfg.max_fail_count)
            conn.commit()
            stats["failed"] += 1
            continue
        db.add_snapshot(conn, video_id, parsed.views, parsed.likes, parsed.comments, parsed.shares, parsed.saves)
        snaps = db.recent_snapshots(conn, video_id, n=max(cfg.min_snapshots_before_drop, 2))
        status = tracking_decision(created_at, snaps, cfg, datetime.now(timezone.utc))
        if starred and status == "dropped":
            status = "tracking"  # starred videos are never dropped for slowing down
        db.set_status(conn, video_id, status)
        conn.commit()
        stats[status] += 1

    log.info("Done. %s", dict(stats))
    if videos and stats["failed"] == len(videos):
        raise SystemExit("Every fetch failed. TikTok is probably blocking: check PROXY_URL.")


if __name__ == "__main__":
    asyncio.run(main())
