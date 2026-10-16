"""One-off probe: does a TikTok Shop product page list the product's videos (ids, views, likes, comments)?

Stores findings in tiktok_watch.runs (job = 'probe_videos'). Never stores credentials.
"""
from __future__ import annotations

import re

import requests

import db
from fetch_product import _unescape
from fetch_video import HEADERS


def main() -> None:
    conn = db.connect()
    with conn.cursor() as cur:
        cur.execute("select product_id, url from tiktok_watch.shop_products where url like '%/pdp/%'"
                    " order by last_sold desc nulls last limit 3")
        rows = cur.fetchall()
    out = {}
    for pid, url in rows:
        r = requests.get(url, headers=HEADERS, timeout=30)
        t = _unescape(r.text)
        info = {"status": r.status_code, "bytes": len(r.text)}
        info["keys"] = sorted(set(re.findall(r'"(\w*(?:video|aweme|play_count|digg|comment_count|view|item_id|content)\w*)":', t, re.I)))[:120]
        ctx = {}
        for k in ["video_count", "format_video_count", "header_video", "desc_video", "video_infos"]:
            i = t.find(f'"{k}":')
            if i != -1:
                ctx[k] = t[max(0, i - 600):i + 1200]
        info["ctx"] = ctx
        # API endpoints the page's own scripts call (where the creator video list would come from)
        info["api_paths"] = sorted(set(re.findall(r'["\'](/api/[a-zA-Z0-9_/\-]+)', r.text)))[:80]
        info["video_ids"] = sorted(set(re.findall(r'"(?:aweme_id|video_id|item_id)":\s*"?(\d{18,20})', t)))[:30]
        info["tiktok_video_links"] = sorted(set(re.findall(r'tiktok\.com/@[\w.]+/video/\d+', t)))[:20]
        out[pid] = info
    run_id = db.start_run(conn, "probe_videos")
    db.finish_run(conn, run_id, True, out)
    conn.close()


if __name__ == "__main__":
    main()
