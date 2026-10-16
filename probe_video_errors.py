"""One-off probe: why do some products return no video list (code 100000)?

Retries a few failed products slowly, with our body and with the seller id and categories read
from the product page itself. Stores findings in tiktok_watch.runs (job = 'probe_video_errors').
"""
from __future__ import annotations

import json
import re
import time

import requests

import db
from fetch_product import _unescape
from fetch_video import HEADERS
from product_videos import API, parse_videos, request_body


def call(body, url):
    r = requests.post(API, data=body, timeout=30, headers={**HEADERS, "Content-Type": "application/json",
                      "Origin": "https://shop.tiktok.com", "Referer": url})
    try:
        j = r.json()
        return {"code": j.get("code"), "msg": str(j.get("message"))[:80], "videos": len(parse_videos(j))}
    except ValueError:
        return {"status": r.status_code, "start": r.text[:120]}


def main() -> None:
    conn = db.connect()
    with conn.cursor() as cur:
        cur.execute("select product_id, seller_id, url from tiktok_watch.shop_products where videos_checked_at is not null"
                    " and video_count is null and not hidden order by last_sold desc limit 6")
        bad = cur.fetchall()
        cur.execute("select product_id, seller_id, url from tiktok_watch.shop_products where video_count > 0 order by last_sold desc limit 2")
        good = cur.fetchall()
    out = {}
    for kind, rows in (("bad", bad), ("good", good)):
        for pid, seller, url in rows:
            res = {"stored_seller": seller}
            res["ours"] = call(request_body(pid, seller), url)
            time.sleep(2)
            page = _unescape(requests.get(url, headers=HEADERS, timeout=30).text)
            m = re.search(r'"seller_id":\s*"(\d+)"', page)
            real_seller = m.group(1) if m else None
            res["page_seller"] = real_seller
            res["page_has_video_section"] = '"video_list"' in page
            res["page_video_count"] = (re.search(r'"related_video_count":\s*"?(\d+)', page) or [None, None])[1]
            if real_seller and real_seller != seller:
                res["with_page_seller"] = call(request_body(pid, real_seller), url)
                time.sleep(2)
            res["no_seller"] = call(request_body(pid, None), url)
            time.sleep(2)
            res["again_ours"] = call(request_body(pid, seller), url)
            out[f"{kind}_{pid}"] = res
            time.sleep(2)
    run_id = db.start_run(conn, "probe_video_errors")
    db.finish_run(conn, run_id, True, out)
    conn.close()


if __name__ == "__main__":
    main()
