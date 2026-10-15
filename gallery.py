"""Product images for the dashboard.

The dashboard runs as a claude.ai artifact, which cannot load images from other hosts, so images are
downloaded here and stored in the database as small base64 webp files:

- a 96px thumbnail for every product in the price band (from the category listing image), and
- the product page gallery (up to GALLERY_MAX images, ~360px) for promising products.

TikTok's image CDN resizes on the fly: the "~tplv-...-crop-webp:800:800.webp" part of an image URL
can be swapped for another size, so no image library is needed.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import random
import re
import time
from concurrent.futures import ThreadPoolExecutor

import requests

import db
import netstats
from fetch_product import _unescape
from fetch_video import HEADERS

log = logging.getLogger("tiktok-watch")
GALLERY_MAX = int(os.environ.get("GALLERY_MAX", "6"))
GALLERY_PER_RUN = int(os.environ.get("GALLERY_PER_RUN", "300"))
# Full galleries only for products that already sell well (or that you starred), to keep the
# free database small. Every product still gets a thumbnail.
GALLERY_MIN_SOLD = int(os.environ.get("GALLERY_MIN_SOLD", "1000"))
THUMBS_PER_RUN = int(os.environ.get("THUMBS_PER_RUN", "1500"))
WORKERS = int(os.environ.get("GALLERY_WORKERS", "6"))
IMG_HEADERS = {"User-Agent": HEADERS["User-Agent"], "Referer": "https://shop.tiktok.com/", "Accept": "image/webp,image/*,*/*;q=0.8"}
TPLV = re.compile(r"~tplv-([a-z0-9]+)-[a-z\-]+(?::\d+:\d+)?\.(?:webp|jpeg|jpg|png|image)")


def sized(url: str, size: int, crop: bool = False) -> str:
    """Ask the CDN for a resized webp of the same image."""
    url = url.replace("&amp;", "&")
    mode = "crop-webp" if crop else "resize-webp"
    new, n = TPLV.subn(lambda m: f"~tplv-{m.group(1)}-{mode}:{size}:{size}.webp", url, count=1)
    return new if n else url


def gallery_urls(html: str) -> list[str]:
    """Image URLs of the product gallery (the first "images" array on the product page), in order."""
    text = _unescape(html)
    i = text.find('"images":[')
    if i == -1:
        return []
    start = text.index("[", i)
    depth, in_str, esc = 0, False, False
    for j in range(start, min(len(text), start + 200_000)):
        c = text[j]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        elif c == '"':
            in_str = True
        elif c == "[":
            depth += 1
        elif c == "]":
            depth -= 1
            if depth == 0:
                break
    else:
        return []
    try:
        items = json.loads(text[start:j + 1])
    except ValueError:
        items = []
    out, seen = [], set()
    for it in items if isinstance(items, list) else []:
        if not isinstance(it, dict):
            continue
        urls = it.get("url_list") or []
        key = it.get("uri") or (urls[0] if urls else None)
        if urls and key not in seen:
            seen.add(key)
            out.append(urls[0].replace("&amp;", "&"))
    if not out:  # fallback: plain URLs in the page order
        for u in re.findall(r'"url_list":\["(https://[^"]+)"', text):
            u = json.loads('"' + u + '"').replace("&amp;", "&")
            m = re.search(r"/([0-9a-f]{32})~", u)
            if m and m.group(1) not in seen:
                seen.add(m.group(1))
                out.append(u)
    return out


def fetch_image(url: str, attempts: int = 2) -> bytes | None:
    for attempt in range(attempts):
        try:
            r = requests.get(url, headers=IMG_HEADERS, timeout=30)
            if r.status_code == 200 and r.headers.get("content-type", "").startswith("image/") and 200 < len(r.content) < 400_000:
                return r.content
        except requests.RequestException:
            pass
        time.sleep(random.uniform(1, 2) * (attempt + 1))
    return None


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def run(conn, min_sold: int, proxies: dict | None, stats) -> None:
    # 1) thumbnails for every product in the band that has a listing image
    todo = db.products_without_thumb(conn, THUMBS_PER_RUN)
    with ThreadPoolExecutor(WORKERS) as pool:
        for (pid, _), data in zip(todo, pool.map(lambda r: fetch_image(sized(r[1], 96, crop=True)), todo)):
            if data:
                db.save_thumb(conn, pid, b64(data))
                stats["thumbs"] += 1
            else:
                stats["thumb_errors"] += 1
    conn.commit()

    # 2) galleries for promising products that do not have one yet
    todo = db.products_without_gallery(conn, max(min_sold, GALLERY_MIN_SOLD), GALLERY_PER_RUN)

    def one(row):
        pid, url = row
        html = None
        for prox in ([None, proxies] if proxies else [None]):
            try:
                r = netstats.get(url, headers=HEADERS, proxies=prox, timeout=30)
                if r.status_code == 200 and '"images":[' in r.text.replace('\\"', '"'):
                    html = r.text
                    break
            except requests.RequestException:
                pass
            time.sleep(random.uniform(1, 2))
        if html is None:
            return pid, None
        imgs = []
        for u in gallery_urls(html)[:GALLERY_MAX]:
            data = fetch_image(sized(u, 320))
            if data:
                imgs.append(b64(data))
        return pid, imgs

    with ThreadPoolExecutor(WORKERS) as pool:
        for pid, imgs in pool.map(one, todo):
            if imgs is None:
                stats["gallery_errors"] += 1
                db.mark_gallery(conn, pid, 0)
                continue
            db.save_gallery(conn, pid, imgs)
            stats["galleries"] += 1
            stats["gallery_images"] += len(imgs)
            conn.commit()
    conn.commit()

    # 3) keep the database small: drop galleries of products nobody will look at again
    stats["galleries_removed"] += db.prune_galleries(conn, max(min_sold, GALLERY_MIN_SOLD))
    conn.commit()


if __name__ == "__main__":  # run only the image step (python gallery.py)
    from collections import Counter

    from core import Config, proxy_settings
    from session import setup_logging

    setup_logging()
    conn = db.connect()
    cfg = Config()
    cfg.apply_overrides(db.load_settings(conn))
    stats: Counter = Counter()
    run_id = db.start_run(conn, "gallery")
    try:
        run(conn, cfg.shop_track_min_sold, proxy_settings(os.environ.get("PROXY_URL"))[1], stats)
    except BaseException as e:
        db.finish_run(conn, run_id, False, dict(stats), str(e))
        raise
    db.finish_run(conn, run_id, True, {**stats, **netstats.summary()})
    log.info("Done. %s", dict(stats))
