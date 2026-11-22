"""Comments of the creator videos of product kits, kept only when they matter for selling.

For every product kit (Termékcsomagok) that has no comments yet (or whose comments are older than
REFRESH_DAYS), read the comments of its most played creator videos with the same TikTokApi browser
session the video collector uses, and keep only the comments that show buying intent or a buyer's
question, worry or experience (size, material, price, shipping, colours, where else to buy).
Small talk ("so pretty", emojis) is dropped.

With --products (hourly workflow) it does the same for the products of the Termékek list, best sellers
first (revenue per day), PRODUCTS_PER_RUN at a time within TIME_BUDGET_S, using the creator videos the
video collector stored for each product (shop_product_videos). State: tiktok_watch.product_comment_state.
"""
from __future__ import annotations

import asyncio
import os
import random
import sys
import time
from collections import Counter
from datetime import datetime, timezone

import db
from comment_filter import classify
from session import setup_logging, tiktok_session

VIDEOS_PER_KIT = int(os.environ.get("COMMENT_VIDEOS", "10"))
PER_VIDEO = int(os.environ.get("COMMENTS_PER_VIDEO", "200"))
KITS_PER_RUN = int(os.environ.get("COMMENT_KITS", "40"))
REFRESH_DAYS = int(os.environ.get("COMMENT_REFRESH_DAYS", "7"))
PAUSE = (4.0, 8.0)          # seconds between two videos: a calm pace, TikTok answers empty when asked too fast
STOP_AFTER_EMPTY = 2        # this many empty answers in a row: stop the kit, the rest is retried on the next run
MAX_TRIES = 4               # runs that may retry a kit's missing videos
PRODUCTS_PER_RUN = int(os.environ.get("COMMENT_PRODUCTS", "35"))
PRODUCT_REFRESH_DAYS = int(os.environ.get("COMMENT_PRODUCT_REFRESH_DAYS", "14"))
TIME_BUDGET_S = int(os.environ.get("COMMENT_TIME_BUDGET_S", "2700"))   # stop starting new products after this


def products_due(conn) -> list[tuple[str, list]]:
    """Listed products with creator videos and no (or old, or unfinished) comments, best sellers first."""
    with conn.cursor() as cur:
        cur.execute("""select l.product_id,
                              (select jsonb_agg(jsonb_build_object('item_id', v.item_id, 'plays', v.play_count) order by v.play_count desc nulls last)
                                 from tiktok_watch.shop_product_videos v where v.product_id = l.product_id)
                       from (select product_id, min(ord) ord, bool_or(prio) prio from (
                               select product_id, ord, false prio from tiktok_watch.listed_ids()
                               union all
                               select product_id, 0, true from tiktok_watch.comment_priority) u group by product_id) l
                       left join tiktok_watch.product_comment_state s using (product_id)
                       where exists (select 1 from tiktok_watch.shop_product_videos v where v.product_id = l.product_id)
                         and (s.comments_at is null or s.comments_at < now() - make_interval(days => %s)
                              or (coalesce((s.stats->>'pending')::int, 0) > 0 and coalesce((s.stats->>'tries')::int, 0) < %s))
                       order by (s.comments_at is not null), l.prio desc, l.ord limit %s""", (PRODUCT_REFRESH_DAYS, MAX_TRIES, PRODUCTS_PER_RUN))
        return cur.fetchall()


def product_stats(conn, pid: str) -> dict:
    with conn.cursor() as cur:
        cur.execute("select stats from tiktok_watch.product_comment_state where product_id = %s", (pid,))
        row = cur.fetchone()
    return (row and row[0]) or {}


def save_product_state(conn, pid: str, summary: dict) -> None:
    with conn.cursor() as cur:
        cur.execute("""insert into tiktok_watch.product_comment_state (product_id, comments_at, stats) values (%s, now(), %s)
                       on conflict (product_id) do update set comments_at = now(), stats = excluded.stats""", (pid, db.Jsonb(summary)))

def kits_due(conn) -> list[tuple[str, list]]:
    with conn.cursor() as cur:
        cur.execute("""select product_id, data->'videos' from tiktok_watch.kits
                       where deleted_at is null and jsonb_array_length(coalesce(data->'videos', '[]')) > 0
                         and (comments_at is null or comments_at < now() - make_interval(days => %s)
                              or (coalesce((comments_stats->>'pending')::int, 0) > 0 and coalesce((comments_stats->>'tries')::int, 0) < %s))
                       order by comments_at nulls first, created_at limit %s""", (REFRESH_DAYS, MAX_TRIES, KITS_PER_RUN))
        return cur.fetchall()


def kit_stats(conn, pid: str) -> dict:
    with conn.cursor() as cur:
        cur.execute("select comments_stats from tiktok_watch.kits where product_id = %s and deleted_at is null", (pid,))
        row = cur.fetchone()
    return (row and row[0]) or {}


def save(conn, pid: str, video_id: str, kept: list[dict]) -> None:
    with conn.cursor() as cur:
        for c in kept:
            cur.execute("""insert into tiktok_watch.video_comments (comment_id, product_id, video_id, text, likes, replies, created_at, lang, tags, fetched_at)
                           values (%s, %s, %s, %s, %s, %s, %s, %s, %s, now())
                           on conflict (comment_id) do update set likes = excluded.likes, replies = excluded.replies, tags = excluded.tags, fetched_at = now()""",
                        (c["id"], pid, video_id, c["text"], c["likes"], c["replies"], c["created_at"], c["lang"], c["tags"]))


async def one_kit(api, conn, pid: str, videos: list, stats: Counter, products: bool = False) -> dict:
    vids = sorted([v for v in videos or [] if v.get("item_id")], key=lambda v: -(v.get("plays") or 0))[:VIDEOS_PER_KIT]
    prev = product_stats(conn, pid) if products else kit_stats(conn, pid)
    done = set(prev.get("done") or [])
    seen, kept_n = int(prev.get("seen") or 0), int(prev.get("kept") or 0)
    by_tag: Counter = Counter(prev.get("by_tag") or {})
    errors, empty_streak, stopped = [], 0, False
    for v in vids:
        if str(v["item_id"]) in done:
            continue
        if empty_streak >= STOP_AFTER_EMPTY:
            stopped = True
            break
        await asyncio.sleep(random.uniform(*PAUSE))
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
            done.add(str(v["item_id"]))
            empty_streak = 0
        except Exception as e:  # one video failing must not stop the kit
            errors.append(f"{v['item_id']}: {type(e).__name__}: {str(e)[:120]}")
            stats["video_errors"] += 1
            if "Empty" in type(e).__name__:
                empty_streak += 1
            elif "KeyError" in type(e).__name__:
                done.add(str(v["item_id"]))   # odd comment data, not worth retrying
        save(conn, pid, str(v["item_id"]), kept)
        kept_n += len(kept)
        conn.commit()
    pending = len([v for v in vids if str(v["item_id"]) not in done])
    summary = {"videos": len(vids), "done": sorted(done), "pending": pending, "tries": int(prev.get("tries") or 0) + 1,
               "seen": seen, "kept": kept_n, "by_tag": dict(by_tag), "errors": errors[:5]}
    if stopped:
        stats["kits_paused"] += 1
    if products:
        save_product_state(conn, pid, summary)
    else:
        with conn.cursor() as cur:
            cur.execute("update tiktok_watch.kits set comments_at = now(), comments_stats = %s where product_id = %s and deleted_at is null",
                        (db.Jsonb(summary), pid))
    conn.commit()
    stats["kits"] += 1
    stats["videos_left"] += pending
    return summary


async def main() -> None:
    setup_logging()
    conn = db.connect()
    products = "--products" in sys.argv
    rid = db.start_run(conn, "comments_products" if products else "comments")
    stats: Counter = Counter()
    start = time.monotonic()
    try:
        todo = products_due(conn) if products else kits_due(conn)
        stats["due"] = len(todo)
        if todo:
            async with tiktok_session() as (api, _):
                paused_in_row = 0
                for pid, videos in todo:
                    if time.monotonic() - start > TIME_BUDGET_S:
                        stats["out_of_time"] = 1
                        break
                    before = stats["kits_paused"]
                    await one_kit(api, conn, pid, videos, stats, products)
                    paused_in_row = paused_in_row + 1 if stats["kits_paused"] > before else 0
                    if paused_in_row >= 3:   # TikTok keeps answering empty: stop for today, the next run continues
                        stats["stopped_early"] = 1
                        break
        db.finish_run(conn, rid, True, dict(stats))
    except Exception as e:
        conn.rollback()
        db.finish_run(conn, rid, False, dict(stats), f"{type(e).__name__}: {str(e)[:300]}")
        raise


if __name__ == "__main__":
    asyncio.run(main())
