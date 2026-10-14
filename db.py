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
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into tiktok_watch.videos
              (video_id, author, description, url, created_at_tt, hashtags, has_product,
               product_title, product_info, source, last_checked)
            values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now())
            on conflict (video_id) do update set
              description = excluded.description,
              product_title = coalesce(excluded.product_title, tiktok_watch.videos.product_title),
              product_info = coalesce(excluded.product_info, tiktok_watch.videos.product_info),
              last_checked = now()
            """,
            (v.video_id, v.author, v.description, v.url, v.created_at, v.hashtags, v.has_product,
             v.product_title, Jsonb(v.product_info) if v.product_info else None, source),
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
            " where status = 'tracking' order by starred desc, first_seen"
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
