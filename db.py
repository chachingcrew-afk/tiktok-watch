"""Postgres access (Supabase). Uses DATABASE_URL, the session pooler connection string."""
from __future__ import annotations

import os
from datetime import datetime

import psycopg
from psycopg.types.json import Jsonb

from core import ParsedVideo


def connect() -> psycopg.Connection:
    url = os.environ["DATABASE_URL"]
    return psycopg.connect(url, autocommit=False, prepare_threshold=None)


def known_ids(conn) -> set[str]:
    with conn.cursor() as cur:
        cur.execute("select video_id from tiktok_watch.videos")
        return {r[0] for r in cur.fetchall()}


def upsert_video(conn, v: ParsedVideo, source: str) -> None:
    p = v.product_info or {}
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into tiktok_watch.videos
              (video_id, author, description, url, created_at_tt, hashtags, has_product,
               product_title, product_info, product_id, product_url, product_image, product_category,
               product_price, source, last_checked)
            values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now())
            on conflict (video_id) do update set
              description = excluded.description,
              product_title = coalesce(excluded.product_title, tiktok_watch.videos.product_title),
              product_info = coalesce(excluded.product_info, tiktok_watch.videos.product_info),
              product_id = coalesce(excluded.product_id, tiktok_watch.videos.product_id),
              product_url = coalesce(excluded.product_url, tiktok_watch.videos.product_url),
              product_image = coalesce(excluded.product_image, tiktok_watch.videos.product_image),
              product_category = coalesce(excluded.product_category, tiktok_watch.videos.product_category),
              product_price = coalesce(excluded.product_price, tiktok_watch.videos.product_price),
              last_checked = now()
            """,
            (v.video_id, v.author, v.description, v.url, v.created_at, v.hashtags, v.has_product,
             v.product_title, Jsonb(p) if p else None, p.get("product_id"), p.get("url"), p.get("image"),
             p.get("category"), p.get("price"), source),
        )


def add_snapshot(conn, video_id: str, views: int, likes: int, comments: int, shares: int, saves: int) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "insert into tiktok_watch.snapshots (video_id, views, likes, comments, shares, saves)"
            " values (%s,%s,%s,%s,%s,%s)",
            (video_id, views, likes, comments, shares, saves),
        )


def tracking_videos(conn) -> list[tuple[str, str, datetime, int, bool]]:
    with conn.cursor() as cur:
        cur.execute(
            "select video_id, url, created_at_tt, fail_count, starred from tiktok_watch.videos"
            " where status = 'tracking' and not hidden order by starred desc, first_seen"
        )
        return cur.fetchall()


def recent_snapshots(conn, video_id: str, n: int = 3) -> list[tuple[datetime, int]]:
    with conn.cursor() as cur:
        cur.execute(
            "select taken_at, views from tiktok_watch.snapshots where video_id = %s"
            " order by taken_at desc limit %s",
            (video_id, n),
        )
        return cur.fetchall()


def set_status(conn, video_id: str, status: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "update tiktok_watch.videos set status = %s, last_checked = now(), fail_count = 0"
            " where video_id = %s",
            (status, video_id),
        )


def mark_failed(conn, video_id: str, max_fail: int) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "update tiktok_watch.videos set fail_count = fail_count + 1,"
            " status = case when fail_count + 1 >= %s then 'dropped' else status end"
            " where video_id = %s",
            (max_fail, video_id),
        )


def load_settings(conn) -> dict:
    with conn.cursor() as cur:
        cur.execute("select key, value from tiktok_watch.settings")
        return {k: v for k, v in cur.fetchall()}


def start_run(conn, job: str) -> int:
    with conn.cursor() as cur:
        cur.execute("insert into tiktok_watch.runs (job) values (%s) returning id", (job,))
        run_id = cur.fetchone()[0]
    conn.commit()
    return run_id


def finish_run(conn, run_id: int, ok: bool, stats: dict, error: str | None = None) -> None:
    conn.rollback()  # discard any half-finished transaction before logging
    with conn.cursor() as cur:
        cur.execute(
            "update tiktok_watch.runs set finished_at = now(), ok = %s, stats = %s, error = %s where id = %s",
            (ok, Jsonb(stats), (error or "")[:2000] or None, run_id),
        )
    conn.commit()


def products_due(conn, hours: int) -> list[tuple[str, str]]:
    """Distinct TikTok Shop products of tracked videos whose price/sales were not read in the last `hours`."""
    with conn.cursor() as cur:
        cur.execute(
            "select product_id, min(product_url) from tiktok_watch.videos"
            " where product_id is not null and product_url is not null and not hidden"
            "   and (status = 'tracking' or starred)"
            " group by product_id"
            " having max(product_checked_at) is null or max(product_checked_at) < now() - make_interval(hours => %s)",
            (hours,),
        )
        return cur.fetchall()


def save_product(conn, product_id: str, info: dict) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "update tiktok_watch.videos set product_price = %s, product_price_max = %s,"
            " product_price_original = %s, product_price_display = %s,"
            " product_sold = coalesce(%s, product_sold), product_checked_at = now()"
            " where product_id = %s",
            (info.get("price_min"), info.get("price_max"), info.get("price_original"),
             info.get("price_display"), info.get("sold"), product_id),
        )
        cur.execute(
            "insert into tiktok_watch.product_snapshots (product_id, sold, price_min, price_max) values (%s,%s,%s,%s)",
            (product_id, info.get("sold"), info.get("price_min"), info.get("price_max")),
        )


def mark_product_checked(conn, product_id: str) -> None:
    with conn.cursor() as cur:
        cur.execute("update tiktok_watch.videos set product_checked_at = now() where product_id = %s", (product_id,))


def hide_cheap_product(conn, product_id: str) -> int:
    """Hide (not delete) the videos of a too-cheap product, unless the user starred them."""
    with conn.cursor() as cur:
        cur.execute(
            "update tiktok_watch.videos set hidden = true, hidden_at = now(), hidden_reason = 'cheap'"
            " where product_id = %s and not starred and not hidden",
            (product_id,),
        )
        return cur.rowcount
