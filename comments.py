"""Comments of the creator videos of product kits, kept only when they matter for selling.

For every product kit (Termékcsomagok) that has no comments yet (or whose comments are older than
REFRESH_DAYS), read the comments of its most played creator videos with the same TikTokApi browser
session the video collector uses, and keep only the comments that show buying intent or a buyer's
question, worry or experience (size, material, price, shipping, colours, where else to buy).
Small talk ("so pretty", emojis) is dropped.
"""
from __future__ import annotations

import asyncio
import os
from collections import Counter
from datetime import datetime, timezone

import db
from comment_filter import classify
from session import setup_logging, tiktok_session

VIDEOS_PER_KIT = int(os.environ.get("COMMENT_VIDEOS", "10"))
PER_VIDEO = int(os.environ.get("COMMENTS_PER_VIDEO", "200"))
KITS_PER_RUN = int(os.environ.get("COMMENT_KITS", "40"))
REFRESH_DAYS = int(os.environ.get("COMMENT_REFRESH_DAYS", "7"))

def kits_due(conn) -> list[tuple[str, list]]:
    with conn.cursor() as cur:
        cur.execute("""select product_id, data->'videos' from tiktok_watch.kits
                       where deleted_at is null and jsonb_array_length(coalesce(data->'videos', '[]')) > 0
                         and (comments_at is null or comments_at < now() - make_interval(days => %s))
                       order by comments_at nulls first, created_at limit %s""", (REFRESH_DAYS, KITS_PER_RUN))
        return cur.fetchall()


def save(conn, pid: str, video_id: str, kept: list[dict]) -> None:
    with conn.cursor() as cur:
        for c in kept:
            cur.execute("""insert into tiktok_watch.video_comments (comment_id, product_id, video_id, text, likes, replies, created_at, lang, tags, fetched_at)
                           values (%s, %s, %s, %s, %s, %s, %s, %s, %s, now())
                           on conflict (comment_id) do update set likes = excluded.likes, replies = excluded.replies, tags = excluded.tags, fetched_at = now()""",
                        (c["id"], pid, video_id, c["text"], c["likes"], c["replies"], c["created_at"], c["lang"], c["tags"]))


async def one_kit(api, conn, pid: str, videos: list, stats: Counter) -> dict:
    vids = sorted([v for v in videos or [] if v.get("item_id")], key=lambda v: -(v.get("plays") or 0))[:VIDEOS_PER_KIT]
    seen = kept_n = 0
    by_tag: Counter = Counter()
    errors = []
    for v in vids:
        kept = []
        try:
            n = 0
            async for c in api.video(id=str(v["item_id"])).comments(count=PER_VIDEO):
                d = c.as_dict
                n += 1
                tags = classify(d.get("text"))
                if tags:
                    ts = d.get("create_time")
                    kept.append({"id": str(d.get("cid")), "text": d.get("text"), "likes": d.get("digg_count") or 0,
                                 "replies": d.get("reply_comment_total") or 0, "lang": d.get("comment_language"), "tags": tags,
                                 "created_at": datetime.fromtimestamp(int(ts), timezone.utc) if ts else None})
                    by_tag.update(tags)
                if n >= PER_VIDEO:
                    break
            seen += n
        except Exception as e:  # one video failing must not stop the kit
            errors.append(f"{v['item_id']}: {type(e).__name__}: {str(e)[:120]}")
            stats["video_errors"] += 1
        save(conn, pid, str(v["item_id"]), kept)
        kept_n += len(kept)
        conn.commit()
    summary = {"videos": len(vids), "seen": seen, "kept": kept_n, "by_tag": dict(by_tag), "errors": errors[:5]}
    with conn.cursor() as cur:
        cur.execute("update tiktok_watch.kits set comments_at = now(), comments_stats = %s where product_id = %s and deleted_at is null",
                    (db.Jsonb(summary), pid))
    conn.commit()
    stats["kits"] += 1
    stats["seen"] += seen
    stats["kept"] += kept_n
    return summary


async def main() -> None:
    setup_logging()
    conn = db.connect()
    rid = db.start_run(conn, "comments")
    stats: Counter = Counter()
    try:
        todo = kits_due(conn)
        if todo:
            async with tiktok_session() as (api, _):
                for pid, videos in todo:
                    await one_kit(api, conn, pid, videos, stats)
        db.finish_run(conn, rid, True, dict(stats))
    except Exception as e:
        conn.rollback()
        db.finish_run(conn, rid, False, dict(stats), f"{type(e).__name__}: {str(e)[:300]}")
        raise


if __name__ == "__main__":
    asyncio.run(main())
