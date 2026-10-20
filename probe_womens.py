"""One-off probe: how many distinct products do women's clothing category pages give, and which
subcategories do they link to?"""
from __future__ import annotations

import re

import db
from fetch_product import _unescape
from shop import fetch_category, parse_category_page

ROOTS = ["womenswear-underwear/601152", "women-s-dresses/842504", "women-s-tops/842248"]


def main() -> None:
    conn = db.connect()
    out = {}
    for root in ROOTS:
        seen, per_page, subs = set(), [], set()
        for n in range(1, 9):
            url = f"https://shop.tiktok.com/us/c/{root}" + (f"?page={n}" if n > 1 else "")
            try:
                html = fetch_category(url, None)
            except Exception as e:  # noqa: BLE001
                per_page.append(f"err {str(e)[:60]}")
                continue
            items = parse_category_page(html)
            new = {p["product_id"] for p in items} - seen
            seen |= {p["product_id"] for p in items}
            per_page.append(f"{len(items)}/{len(new)}new")
            subs |= set(re.findall(r"/us/c/([a-z0-9\-]+/\d+)", _unescape(html)))
            prices = [p["price"] for p in items if p["price"]]
        out[root] = {"unique": len(seen), "pages": per_page, "subcats": sorted(subs)[:80],
                     "price_sample": sorted(prices)[:3] + sorted(prices)[-3:] if prices else []}
    run_id = db.start_run(conn, "probe_womens")
    db.finish_run(conn, run_id, True, out)
    conn.close()


if __name__ == "__main__":
    main()
