"""One-off probe: category links (slug/id) on given products' pages."""
from __future__ import annotations

import re

import requests

import db
from fetch_product import _unescape
from fetch_video import HEADERS

PIDS = ["1731603196057654264", "1732535865680106446", "1729620713981776465"]


def main() -> None:
    conn = db.connect()
    out = {}
    with conn.cursor() as cur:
        cur.execute("select product_id, url from tiktok_watch.shop_products where product_id = any(%s)", (PIDS,))
        rows = cur.fetchall()
    for pid, url in rows:
        t = _unescape(requests.get(url, headers=HEADERS, timeout=30).text)
        cats = re.findall(r'"category_id":\s*"(\d+)",\s*"level":\s*(\d),[^{}]*?"category_name":\s*"([^"]+)"', t)
        out[pid] = {"cats": cats[:6], "links": sorted(set(re.findall(r"/us/c/([a-z0-9\-]+/\d+)", t)) & set(
            l for l in re.findall(r"/us/c/([a-z0-9\-]+/\d+)", t) if any(k in l for k in ("tight", "legging", "sock", "hosier", "women"))))}
    run_id = db.start_run(conn, "probe_catpath")
    db.finish_run(conn, run_id, True, out)
    conn.close()


if __name__ == "__main__":
    main()
