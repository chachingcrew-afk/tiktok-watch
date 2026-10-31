"""One-off probe: find TikTok Shop US category pages for occasion dresses (party, cocktail, evening, formal,
prom, wedding guest...) and how deep their listings go. Result goes to the runs table (job = probe name)."""
from __future__ import annotations

import re

import requests

import db
from fetch_video import HEADERS
from shop import category_name, parse_category_page

LINK = re.compile(r'shop\.tiktok\.com(?:\\u002F|/)us(?:\\u002F|/)c(?:\\u002F|/)([a-z0-9\-]+)(?:\\u002F|/)(\d+)')
WANT = re.compile(r"dress|gown|prom|party|cocktail|evening|formal|wedding|bridesmaid|homecoming|jumpsuit|romper|occasion|club|maxi|midi|mini|bodycon|sequin|satin", re.I)
SEEDS = ["women-s-dresses/842504", "formal-dresses/601271", "dresses/889096", "casual-dresses/601281",
         "womenswear-underwear/601152", "women-s-special-clothing/842632"]


def get(url):
    try:
        r = requests.get(url, headers=HEADERS, timeout=30)
        return r.text if r.status_code == 200 else ""
    except requests.RequestException:
        return ""


def summary(html):
    ps = parse_category_page(html)
    prices = [p["price"] for p in ps if p.get("price") is not None]
    return {"n": len(ps), "in_25_90": sum(1 for x in prices if 25 <= x <= 90),
            "sold_med": sorted([p["sold"] or 0 for p in ps])[len(ps) // 2] if ps else None}


def main() -> None:
    conn = db.connect()
    run_id = db.start_run(conn, "probe_occasion_cats")
    found: dict[str, dict] = {}
    queue = list(SEEDS)
    seen = set()
    while queue and len(seen) < 60:
        cat = queue.pop(0)
        if cat in seen:
            continue
        seen.add(cat)
        html = get(f"https://shop.tiktok.com/us/c/{cat}")
        if not html:
            found[cat] = {"error": "no page"}
            continue
        info = {"name": category_name(html), **summary(html)}
        found[cat] = info
        for slug, cid in LINK.findall(html):
            c = f"{slug}/{cid}"
            if c not in seen and WANT.search(slug):
                queue.append(c)
    # how deep do the most relevant listings go
    for cat, info in list(found.items()):
        if info.get("n") and WANT.search(cat):
            depth = {}
            for page in (5, 10, 20, 30):
                h = get(f"https://shop.tiktok.com/us/c/{cat}?page={page}")
                depth[page] = len(parse_category_page(h)) if h else 0
            info["depth"] = depth
    db.finish_run(conn, run_id, True, {"categories": found})
    print(found)


if __name__ == "__main__":
    main()
