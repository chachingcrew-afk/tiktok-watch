"""Creator videos of TikTok Shop products ("Videos for this product" on the product page).

The desktop product page loads that section from shop.tiktok.com/api/shop/pdp_desktop/page_data, a
plain POST that needs no signature, login or proxy. We ask it only for the video_list component of
one product and store each video's views, likes, title, creator and upload date. A small cover
image is stored for the best videos of promising products (the dashboard cannot load TikTok images).
"""
from __future__ import annotations

import base64
import io
import json
import logging
import os
import random
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import requests

import db
import netstats
from fetch_video import HEADERS

log = logging.getLogger("tiktok-watch")
API = "https://shop.tiktok.com/api/shop/pdp_desktop/page_data"
WORKERS = int(os.environ.get("VIDEOS_WORKERS", "8"))
PER_RUN = int(os.environ.get("VIDEOS_PER_RUN", "1500"))
COVERS_PER_PRODUCT = int(os.environ.get("VIDEOS_COVERS", "6"))


def request_body(product_id: str, seller_id: str | None) -> str:
    info = {"product_id": str(product_id)}
    if seller_id:
        info["seller_id"] = str(seller_id)
    # Same shape the product page itself sends (only the video_list component); a body without
    # the nova_config block or error_code is rejected with code 100000.
    page_config = {
        "global_fe_config": {"page_name": "product_detail"},
        "global_api_data_config": {"nova_config": {"api": "nova_config", "params": {
            "resource_type_list": [1], "nova_source_key_list": ["view_tts_web_seo_source_key_black_friday_settings"]}}},
        "components_map": [{
            "component_type": "video_list", "component_name": "video_list",
            "fe_config": {"data_source": {"need_split_request": True, "need_product_info": True,
                                          "need_fetch_at_first_screen": False}},
        }],
        "global_data": {"product_info": {"error_code": 0, "product_info": {**info, "product_model": dict(info)}}},
    }
    return json.dumps({"page_config": json.dumps(page_config)})


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def parse_videos(payload: dict) -> list[dict]:
    """related_videos of the video_list component, in the page's order."""
    out = []
    for comp in ((payload.get("data") or {}).get("components_map") or []):
        data = comp.get("component_data") if isinstance(comp, dict) else None
        if not isinstance(data, dict):
            continue
        for i, v in enumerate(data.get("related_videos") or []):
            if not isinstance(v, dict) or not v.get("item_id"):
                continue
            up = _int(v.get("upload_time"))
            out.append({
                "item_id": str(v["item_id"]),
                "author_id": str(v.get("author_id") or "") or None,
                "author_name": (v.get("author_name") or "").strip()[:200] or None,
                "title": (v.get("title") or "").strip()[:500] or None,
                "upload_time": datetime.fromtimestamp(up, tz=timezone.utc) if up else None,
                "duration_ms": _int(v.get("duration")),
                "play_count": _int(v.get("play_count")),
                "like_count": _int(v.get("like_count")),
                "cover_url": v.get("cover_image_url"),
                "rank": i,
            })
    return out


def fetch_videos(product_id: str, seller_id: str | None, url: str | None, attempts: int = 4) -> list[dict]:
    """The endpoint answers some requests with code 100000 (no data): sometimes only with the
    seller id, sometimes only without it, sometimes just under load. Alternate both forms, back off."""
    last = None
    for attempt in range(attempts):
        seller = seller_id if attempt % 2 == 0 else None
        try:
            r = netstats_post(product_id, seller, url)
            if r.status_code == 200:
                j = r.json()
                if j.get("code") == 0:
                    return parse_videos(j)
                last = RuntimeError(f"code {j.get('code')}: {str(j.get('message'))[:80]}")
            else:
                last = RuntimeError(f"HTTP {r.status_code}")
        except (requests.RequestException, ValueError) as e:
            last = e
        time.sleep(random.uniform(1, 2.5) * (attempt + 1))
    raise last or RuntimeError("fetch failed")


def netstats_post(product_id, seller_id, url):
    with netstats._lock:
        netstats.DIRECT["requests"] += 1
    return requests.post(API, data=request_body(product_id, seller_id), timeout=30, headers={
        **HEADERS, "Content-Type": "application/json", "Accept": "application/json, text/plain, */*",
        "Origin": "https://shop.tiktok.com", "Referer": url or "https://shop.tiktok.com/us"})


def small_cover(url: str | None) -> str | None:
    if not url:
        return None
    try:
        from PIL import Image
        r = requests.get(url, headers={"User-Agent": HEADERS["User-Agent"], "Referer": "https://shop.tiktok.com/"}, timeout=20)
        if r.status_code != 200 or len(r.content) < 500:
            return None
        img = Image.open(io.BytesIO(r.content)).convert("RGB")
        img.thumbnail((144, 256))
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=68, optimize=True)
        return base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception:
        return None


def run(conn, min_sold: int, stats: Counter, limit: int = PER_RUN) -> None:
    todo = db.products_for_videos(conn, min_sold, limit)
    if not todo:
        return

    def one(row):
        pid, seller_id, url, want_covers = row
        try:
            vids = fetch_videos(pid, seller_id, url)
        except Exception as e:  # noqa: BLE001
            return pid, e, None
        if want_covers:
            for v in sorted(vids, key=lambda x: -(x["play_count"] or 0))[:COVERS_PER_PRODUCT]:
                v["cover"] = small_cover(v["cover_url"])
        return pid, vids, want_covers

    with ThreadPoolExecutor(WORKERS) as pool:
        for pid, vids, want_covers in pool.map(one, todo):
            if isinstance(vids, Exception):
                stats["video_errors"] += 1
                db.mark_videos_checked(conn, pid)
            else:
                db.save_product_videos(conn, pid, vids, keep_covers=bool(want_covers))
                stats["video_products"] += 1
                stats["videos"] += len(vids)
            conn.commit()


if __name__ == "__main__":  # python product_videos.py [limit]
    import sys

    from core import Config
    from session import setup_logging

    setup_logging()
    conn = db.connect()
    cfg = Config()
    cfg.apply_overrides(db.load_settings(conn))
    stats: Counter = Counter()
    run_id = db.start_run(conn, "videos")
    try:
        run(conn, cfg.shop_track_min_sold, stats, int(sys.argv[1]) if len(sys.argv) > 1 else PER_RUN)
    except BaseException as e:
        db.finish_run(conn, run_id, False, {**stats, **netstats.summary()}, str(e))
        raise
    db.finish_run(conn, run_id, True, {**stats, **netstats.summary()})
    log.info("Done. %s", dict(stats))
