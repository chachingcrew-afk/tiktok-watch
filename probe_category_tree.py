"""One-off probe: map the TikTok Shop US category pages (slug/id -> name, products per load).

Walks category pages breadth first from a few seeds, collecting every /us/c/<slug>/<id> link it sees,
and stores the map in tiktok_watch.runs (job 'probe_category_tree'). Plain HTTP from GitHub's IP.
"""
from __future__ import annotations

import re
import time
from collections import deque

import requests

import db
from fetch_video import HEADERS
from shop import category_name, parse_category_page

LINK = re.compile(r'/us/c/([a-z0-9\-]+)/(\d+)')
SEEDS = ["beauty-personal-care/601450", "health/700645", "baby-maternity/601306", "toys-hobbies/604206",
         "kids-fashion/802184", "home-supplies/600001", "pet-supplies/602118", "personal-care-appliances/849416",
         "haircare-styling/848904", "bedding-and-linens/808328", "fitness/835336", "dog-cat-accessories/818696"]
MAX_PAGES = 260


def get(url):
    try:
        r = requests.get(url, headers=HEADERS, timeout=30)
        return r.text if r.status_code == 200 else ""
    except requests.RequestException:
        return ""


def main() -> None:
    conn = db.connect()
    found: dict[str, dict] = {}
    queue, seen = deque(f"{s}" for s in SEEDS), set()
    while queue and len(seen) < MAX_PAGES:
        key = queue.popleft()
        if key in seen:
            continue
        seen.add(key)
        html = get(f"https://shop.tiktok.com/us/c/{key}")
        time.sleep(0.4)
        if not html:
            found.setdefault(key, {})["error"] = True
            continue
        found[key] = {"name": category_name(html), "products": len(parse_category_page(html)) if "productList" in html else 0}
        for slug, cid in LINK.findall(html):
            k = f"{slug}/{cid}"
            if k not in seen:
                queue.append(k)
    rid = db.start_run(conn, "probe_category_tree")
    db.finish_run(conn, rid, True, {"pages": len(seen), "categories": found})
    print(len(seen), len(found))


if __name__ == "__main__":
    main()
