"""One-off probe: replay the product page's page_data POST with a plain request and look for the
creator videos in the response; also check how the product id is passed.

Stores findings in tiktok_watch.runs (job = 'probe_pagedata2'). Never stores credentials.
"""
from __future__ import annotations

import json
import re

import requests

import db
from fetch_video import HEADERS
from probe_pagedata_browser import find_paths


def main() -> None:
    conn = db.connect()
    with conn.cursor() as cur:
        cur.execute("select stats->'calls'->0->>'post', stats->>'url' from tiktok_watch.runs where job='probe_pagedata' order by id desc limit 1")
        post, url = cur.fetchone()
    pid = re.search(r"/(\d{15,20})", url).group(1)
    out = {"post_len": len(post or ""), "pid_in_post": (post or "").count(pid),
           "post_tail": (post or "")[-1500:]}
    r = requests.post("https://shop.tiktok.com/api/shop/pdp_desktop/page_data", data=post,
                      headers={**HEADERS, "Content-Type": "application/json", "Origin": "https://shop.tiktok.com", "Referer": url}, timeout=30)
    out["status"] = r.status_code
    try:
        j = r.json()
        out["paths"] = find_paths(j, r"(?i)digg|like|play_count|nickname|author|creator|video_list|item_list|aweme")[:40]
        comps = (j.get("data") or {}).get("components_data") or (j.get("data") or {}).get("component_data")
        out["data_keys"] = list((j.get("data") or {}).keys())[:40]
        txt = json.dumps(j)
        i = txt.find("Creator earns") if "Creator earns" in txt else txt.find("digg")
        out["ctx"] = txt[max(0, i - 1500):i + 1500] if i > 0 else None
    except ValueError:
        out["start"] = r.text[:500]
    run_id = db.start_run(conn, "probe_pagedata2")
    db.finish_run(conn, run_id, True, json.loads(json.dumps(out, default=str)))
    conn.close()


if __name__ == "__main__":
    main()
