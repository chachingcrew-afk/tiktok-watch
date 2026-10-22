"""Postgres access (Supabase). Uses DATABASE_URL, the session pooler connection string."""
from __future__ import annotations

import os
from datetime import datetime, timezone

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
            "insert into tiktok_watch.product_snapshots (product_id, sold, price_min, price_max, source) values (%s,%s,%s,%s,'page')",
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


# ---------- TikTok Shop category scan ----------

def upsert_shop_product(conn, p: dict) -> bool:
    """Save a product seen in a category listing. Returns False while the product stays retired."""
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into tiktok_watch.shop_products
              (product_id, title, url, image, category_id, category_name, shop_name, seller_id,
               price, price_original, rating, reviews, last_sold, focus, first_seen, last_seen, last_checked)
            values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now(), now(), now())
            on conflict (product_id) do update set
              focus = coalesce(excluded.focus, tiktok_watch.shop_products.focus),
              title = coalesce(excluded.title, tiktok_watch.shop_products.title),
              url = coalesce(excluded.url, tiktok_watch.shop_products.url),
              image = coalesce(excluded.image, tiktok_watch.shop_products.image),
              shop_name = coalesce(excluded.shop_name, tiktok_watch.shop_products.shop_name),
              price = excluded.price,
              price_original = excluded.price_original,
              rating = coalesce(excluded.rating, tiktok_watch.shop_products.rating),
              reviews = coalesce(excluded.reviews, tiktok_watch.shop_products.reviews),
              last_sold = coalesce(excluded.last_sold, tiktok_watch.shop_products.last_sold),
              last_seen = now(), last_checked = now(),
              retired_at = case when tiktok_watch.shop_products.retired_at is not null and excluded.last_sold is not null
                  and excluded.last_sold >= coalesce(tiktok_watch.shop_products.retired_sold, 0) + greatest(30,
                      extract(epoch from now() - tiktok_watch.shop_products.retired_at) / 86400.0
                      * coalesce((select (value)::text::numeric from tiktok_watch.settings where key = 'retire_below_per_day'), 3))
                then null else tiktok_watch.shop_products.retired_at end
            returning retired_at is null
            """,
            (p["product_id"], p.get("title"), p.get("url"), p.get("image"), p.get("category_id"),
             p.get("category_name"), p.get("shop_name"), p.get("seller_id"), p.get("price"),
             p.get("price_original"), p.get("rating"), p.get("reviews"), p.get("sold"), p.get("focus")),
        )
        return bool(cur.fetchone()[0])


def add_product_snapshot(conn, product_id: str, sold, price_min, price_max, source: str) -> None:
    """source: 'listing' (category page) or 'page' (product page). The two report units sold
    differently (the listing number lags), so sales per day only compares snapshots of one source."""
    with conn.cursor() as cur:
        cur.execute(
            "insert into tiktok_watch.product_snapshots (product_id, sold, price_min, price_max, source) values (%s,%s,%s,%s,%s)",
            (product_id, sold, price_min, price_max, source),
        )


def shop_products_to_refresh(conn, min_sold: int) -> list[tuple[str, str]]:
    """Promising products (sold enough, seen in the last 2 weeks) whose product page was not read in the last 10 hours."""
    with conn.cursor() as cur:
        cur.execute(
            "select product_id, url from tiktok_watch.shop_products"
            " where not hidden and retired_at is null and url is not null and (coalesce(last_sold, 0) >= %s or starred)"
            "   and last_seen > now() - interval '14 days'"
            "   and (page_checked_at is null or page_checked_at < now() - interval '5 hours')"
            " order by starred desc, last_sold desc nulls last",
            (min_sold,),
        )
        return cur.fetchall()


def shop_products_6h(conn, min_price: float, max_price: float, limit: int, fmin: float = 0, fmax: float = 0) -> list[tuple[str, str]]:
    """Products for the sales check: starred first, then fast sellers (20+/day) every run, then the rest
    oldest-checked first, so products without a daily rate yet get their second measurement too."""
    with conn.cursor() as cur:
        cur.execute(
            "select p.product_id, p.url from tiktok_watch.shop_products p"
            " left join tiktok_watch.shop_product_scores v using (product_id)"
            " where not p.hidden and p.retired_at is null and p.url is not null and p.last_seen > now() - interval '14 days'"
            "   and (p.starred or p.price between %s and %s or p.price is null or (p.focus = 'women' and p.price between %s and %s))"
            "   and (p.page_checked_at is null or p.page_checked_at < now() - interval '5 hours')"
            " order by p.starred desc, (coalesce(v.sold_per_day, 0) >= 20) desc, p.page_checked_at asc nulls first limit %s",
            (min_price, max_price, fmin, fmax, limit),
        )
        return cur.fetchall()


def touch_shop_product(conn, product_id: str) -> None:
    with conn.cursor() as cur:
        cur.execute("update tiktok_watch.shop_products set last_checked = now(), page_checked_at = now() where product_id = %s", (product_id,))


def save_shop_product_page(conn, product_id: str, info: dict) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "update tiktok_watch.shop_products set last_checked = now(), page_checked_at = now(),"
            " last_sold = coalesce(%s, last_sold), price = coalesce(%s, price),"
            " price_original = coalesce(%s, price_original) where product_id = %s",
            (info.get("sold"), info.get("price_min"), info.get("price_original"), product_id),
        )


# ---------- product images (gallery.py) ----------

def products_without_thumb(conn, limit: int) -> list[tuple[str, str]]:
    with conn.cursor() as cur:
        cur.execute(
            "select product_id, image from tiktok_watch.shop_products"
            " where thumb is null and image is not null and not hidden and retired_at is null and last_seen > now() - interval '14 days'"
            " order by last_sold desc nulls last limit %s",
            (limit,),
        )
        return cur.fetchall()


def save_thumb(conn, product_id: str, data: str) -> None:
    with conn.cursor() as cur:
        cur.execute("update tiktok_watch.shop_products set thumb = %s where product_id = %s", (data, product_id))


def products_without_gallery(conn, min_sold: int, limit: int) -> list[tuple[str, str]]:
    """Promising products with no gallery yet (failed attempts are retried after 3 days)."""
    with conn.cursor() as cur:
        cur.execute(
            "select product_id, url from tiktok_watch.shop_products"
            " where url is not null and not hidden and retired_at is null and (coalesce(last_sold, 0) >= %s or starred)"
            "   and last_seen > now() - interval '14 days'"
            "   and (gallery_at is null or (coalesce(gallery_count, 0) = 0 and gallery_at < now() - interval '3 days'))"
            " order by starred desc, last_sold desc nulls last limit %s",
            (min_sold, limit),
        )
        return cur.fetchall()


def save_gallery(conn, product_id: str, images: list[str]) -> None:
    with conn.cursor() as cur:
        cur.execute("delete from tiktok_watch.shop_product_images where product_id = %s", (product_id,))
        for i, data in enumerate(images):
            cur.execute("insert into tiktok_watch.shop_product_images (product_id, idx, data) values (%s,%s,%s)", (product_id, i, data))
        cur.execute("update tiktok_watch.shop_products set gallery_at = now(), gallery_count = %s where product_id = %s",
                    (len(images), product_id))


def mark_gallery(conn, product_id: str, count: int) -> None:
    with conn.cursor() as cur:
        cur.execute("update tiktok_watch.shop_products set gallery_at = now(), gallery_count = %s where product_id = %s",
                    (count, product_id))


def prune_galleries(conn, min_sold: int) -> int:
    """Remove galleries nobody will look at again: hidden products, products not listed for 10 days,
    and products selling less than min_sold. Starred products always keep theirs."""
    cond = ("not p.starred and (p.hidden or p.last_seen < now() - interval '10 days'"
            " or coalesce(p.last_sold, 0) < %s)")
    with conn.cursor() as cur:
        cur.execute("delete from tiktok_watch.shop_product_images i using tiktok_watch.shop_products p"
                    " where p.product_id = i.product_id and " + cond, (min_sold,))
        n = cur.rowcount
        cur.execute("update tiktok_watch.shop_products p set gallery_at = null, gallery_count = null"
                    " where gallery_count > 0 and " + cond, (min_sold,))
        return n


# ---------- creator videos of shop products (product_videos.py) ----------

def products_for_videos(conn, min_sold: int, limit: int) -> list[tuple]:
    """(product_id, seller_id, url, want_covers) for promising products whose videos were not read today.
    Covers only for the products that also get a full gallery (1000+ sold or starred)."""
    with conn.cursor() as cur:
        cur.execute(
            "select product_id, seller_id, url, (starred or coalesce(last_sold, 0) >= 1000) from tiktok_watch.shop_products"
            " where not hidden and retired_at is null and url is not null and (coalesce(last_sold, 0) >= %s or starred)"
            "   and last_seen > now() - interval '14 days'"
            "   and (videos_checked_at is null or videos_checked_at < now() - interval '20 hours'"
            "        or (video_count is null and videos_checked_at < now() - interval '1 hour'))"
            " order by starred desc, (video_count is null and videos_checked_at is not null) desc, last_sold desc nulls last limit %s",
            (min_sold, limit),
        )
        return cur.fetchall()


def mark_videos_checked(conn, product_id: str) -> None:
    with conn.cursor() as cur:
        cur.execute("update tiktok_watch.shop_products set videos_checked_at = now() where product_id = %s", (product_id,))


def save_product_videos(conn, product_id: str, videos: list[dict], keep_covers: bool) -> None:
    with conn.cursor() as cur:
        for v in videos:
            cur.execute(
                """
                insert into tiktok_watch.shop_product_videos
                  (product_id, item_id, author_id, author_name, title, upload_time, duration_ms, play_count, like_count, cover, rank)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                on conflict (product_id, item_id) do update set
                  prev_play_count = tiktok_watch.shop_product_videos.play_count,
                  prev_like_count = tiktok_watch.shop_product_videos.like_count,
                  prev_checked_at = tiktok_watch.shop_product_videos.checked_at,
                  play_count = excluded.play_count, like_count = excluded.like_count,
                  title = coalesce(excluded.title, tiktok_watch.shop_product_videos.title),
                  author_name = coalesce(excluded.author_name, tiktok_watch.shop_product_videos.author_name),
                  cover = coalesce(excluded.cover, tiktok_watch.shop_product_videos.cover),
                  rank = excluded.rank, checked_at = now()
                """,
                (product_id, v["item_id"], v.get("author_id"), v.get("author_name"), v.get("title"), v.get("upload_time"),
                 v.get("duration_ms"), v.get("play_count"), v.get("like_count"), v.get("cover") if keep_covers else None, v.get("rank")),
            )
        cur.execute(
            "update tiktok_watch.shop_products set videos_checked_at = now(), video_count = %s,"
            " video_views = %s, video_likes = %s where product_id = %s",
            (len(videos), sum(v.get("play_count") or 0 for v in videos), sum(v.get("like_count") or 0 for v in videos), product_id),
        )


# ---------- fresh videos from the hashtag feeds, linked to shop products ----------

def link_feed_video(conn, v: ParsedVideo) -> None:
    """A fresh feed video with a TikTok Shop product: make sure the product is known (so its sales get
    measured) and record the video under it. The product page's own video list is months old, so
    these feed videos are what shows that a product is being pushed right now."""
    for p in (v.products or [v.product_info or {}]):
        if p.get("product_id"):
            _link_feed_product(conn, v, p)


def _link_feed_product(conn, v: ParsedVideo, p: dict) -> None:
    pid = p["product_id"]
    cat = (p.get("category") or "").split(" › ")[-1] or None
    focus = "women" if (p.get("category") or "").startswith("Womenswear") else None
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into tiktok_watch.shop_products (product_id, title, url, image, category_name, seller_id, price, focus, first_seen, last_seen)
            values (%s,%s,%s,%s,%s,%s,%s,%s, now(), now())
            on conflict (product_id) do update set last_seen = now(),
              focus = coalesce(tiktok_watch.shop_products.focus, excluded.focus),
              title = coalesce(tiktok_watch.shop_products.title, excluded.title),
              url = coalesce(tiktok_watch.shop_products.url, excluded.url),
              image = coalesce(tiktok_watch.shop_products.image, excluded.image),
              seller_id = coalesce(tiktok_watch.shop_products.seller_id, excluded.seller_id),
              price = coalesce(tiktok_watch.shop_products.price, excluded.price),
              retired_at = case when %s then null else tiktok_watch.shop_products.retired_at end
            """,
            (pid, p.get("title") or v.product_title, p.get("url"), p.get("image"), cat, p.get("seller_id"), p.get("price"), focus,
             v.created_at is not None and (datetime.now(timezone.utc) - v.created_at).days < 7),
        )
        cur.execute(
            """
            insert into tiktok_watch.shop_product_videos (product_id, item_id, author_name, title, upload_time, play_count, like_count, rank, source)
            values (%s,%s,%s,%s,%s,%s,%s, 1000, 'feed')
            on conflict (product_id, item_id) do update set
              prev_play_count = tiktok_watch.shop_product_videos.play_count,
              prev_like_count = tiktok_watch.shop_product_videos.like_count,
              prev_checked_at = tiktok_watch.shop_product_videos.checked_at,
              play_count = excluded.play_count, like_count = excluded.like_count, checked_at = now()
            """,
            (pid, v.video_id, v.author, (v.description or "")[:500] or None, v.created_at, v.views, v.likes),
        )


# ---------- retiring slow products ----------

def retire_slow(conn) -> int:
    """Products whose measured daily sales stay under the 'retire_below_per_day' setting leave tracking:
    their snapshots, images and creator videos are deleted, only the product row stays (marked retired)
    so the daily scan does not add them again. Starred products and products with a creator video from
    the last 7 days are kept. A retired product comes back when it starts selling again (see upsert_shop_product)."""
    with conn.cursor() as cur:
        cur.execute("select coalesce((select (value)::text::numeric from tiktok_watch.settings where key = 'retire_below_per_day'), 3)")
        limit = cur.fetchone()[0]
        if not limit or limit <= 0:
            return 0
        cur.execute(
            """
            select v.product_id, v.sold_now from tiktok_watch.shop_product_scores v
            join tiktok_watch.shop_products p using (product_id)
            where p.retired_at is null and not p.starred
              and v.sold_per_day is not null and v.sold_per_day < %s
              and not exists (select 1 from tiktok_watch.shop_product_videos pv where pv.product_id = v.product_id
                              and pv.source = 'feed' and pv.upload_time > now() - interval '7 days')
            """,
            (limit,),
        )
        rows = cur.fetchall()
        if not rows:
            return 0
        ids = [r[0] for r in rows]
        cur.executemany(
            "update tiktok_watch.shop_products set retired_at = now(), retired_sold = coalesce(%s, last_sold),"
            " thumb = null, gallery_at = null, gallery_count = null, video_count = null, video_views = null,"
            " video_likes = null, videos_checked_at = null, other_shops = null, twin_shops = null where product_id = %s",
            [(sold, pid) for pid, sold in rows],
        )
        for table in ("shop_product_images", "shop_product_videos", "product_snapshots"):
            cur.execute(f"delete from tiktok_watch.{table} where product_id = any(%s)", (ids,))
    conn.commit()
    return len(ids)
