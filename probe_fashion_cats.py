"""One-off probe: find TikTok Shop US category pages for women's clothing (slug/id, name, products per load)."""
from __future__ import annotations

import re
from collections import deque

import requests

import db
from fetch_product import _unescape
from fetch_video import HEADERS
from shop import category_name, parse_category_page

LINK = re.compile(r'shop\.tiktok\.com/us/c/([a-z0-9\-]+)/(\d+)')
WOMEN = re.compile(r"wom|ladies|dress|lingerie|bra|skirt|blouse|jumpsuit|legging|shapewear|swim|sleep|lounge|knit|coat|jacket|top|bottom|jean|pant|short|set|sweater|hood|activ|apparel|clothing|underwear|maternity|plus", re.I)


def get(url):
    try:
        r = requests.get(url, headers=HEADERS, timeout=30)
        return r.text if r.status_code == 200 else ""
    except requests.RequestException:
        return ""


def main() -> None:
    conn = db.connect()
    with conn.cursor() as cur:
        cur.execute("select value from tiktok_watch.settings where key='shop_categories'")
        seeds = cur.fetchone()[0][:6]
    found, queue = {}, deque()
    for s in seeds:
        queue.append((f"https://shop.tiktok.com/us/c/{s}", 0))
    seen_pages = set()
    while queue and len(seen_pages) < 140:
        url, depth = queue.popleft()
        if url in seen_pages:
            continue
        seen_pages.add(url)
        html = get(url)
        if not html:
            continue
        text = _unescape(html)
        m = LINK.search(url)
        if m:
            key = f"{m.group(1)}/{m.group(2)}"
            prods = parse_category_page(html)
            found[key] = {"name": category_name(html), "products": len(prods),
                          "prices": sorted(p["price"] for p in prods)[len(prods) // 2] if prods else None}
        for slug, cid in set(LINK.findall(text)):
            key = f"{slug}/{cid}"
            if key not in found and (depth == 0 or WOMEN.search(slug)) and ("wom" in slug or depth < 2):
                queue.append((f"https://shop.tiktok.com/us/c/{key}", depth + 1))
            found.setdefault(key, {"name": None, "products": None})
    womens = {k: v for k, v in found.items() if re.search(r"wom|dress|lingerie|bra|skirt|blouse|jumpsuit|shapewear", k)}
    run_id = db.start_run(conn, "probe_fashion_cats")
    db.finish_run(conn, run_id, True, {"pages": len(seen_pages), "all_count": len(found), "womens": womens,
                                       "all_slugs": sorted(found.keys())[:400]})
    conn.close()


if __name__ == "__main__":
    main()
