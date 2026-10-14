"""One-off probe: where does a TikTok Shop product page keep its image gallery, and can the images be downloaded?

Stores findings in tiktok_watch.runs (job = 'probe_gallery'). Never stores credentials.
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
        cur.execute("select product_id, url from tiktok_watch.shop_products order by last_sold desc nulls last limit 2")
        rows = cur.fetchall()
    out = {}
    for pid, url in rows:
        r = requests.get(url, headers=HEADERS, timeout=30)
        t = _unescape(r.text)
        info = {"status": r.status_code, "bytes": len(r.text)}
        keys = sorted(set(re.findall(r'"(\w*(?:image|img|gallery|picture|photo|main_images|thumb)\w*)":', t)))
        info["keys"] = keys[:80]
        ctx = {}
        for k in ["main_images", "images", "product_images", "img_list", "sku_img"]:
            i = t.find(f'"{k}":')
            if i != -1:
                ctx[k] = t[i:i + 1500]
        info["ctx"] = ctx
        urls = re.findall(r'https://p\d+-oec[^"\s\\]+', t)
        hashes = {}
        for u in urls:
            m = re.search(r'/([0-9a-f]{32})~', u)
            if m and m.group(1) not in hashes:
                hashes[m.group(1)] = u
        info["distinct_images"] = len(hashes)
        info["sample_urls"] = list(hashes.values())[:12]
        if hashes:
            u = next(iter(hashes.values()))
            u2 = re.sub(r'~tplv-[^.?]+', '~tplv-fhlh96nyum-resize-webp:400:400', u)
            for name, link in [("orig", u), ("resized", u2)]:
                try:
                    ir = requests.get(link, headers={"User-Agent": HEADERS["User-Agent"], "Referer": "https://shop.tiktok.com/"}, timeout=30)
                    info["img_" + name] = {"status": ir.status_code, "bytes": len(ir.content), "type": ir.headers.get("content-type"), "url": link[:300]}
                except Exception as e:
                    info["img_" + name] = {"error": type(e).__name__ + ": " + str(e)[:150]}
        out[pid] = info
    run_id = db.start_run(conn, "probe_gallery")
    db.finish_run(conn, run_id, True, out)
    conn.close()


if __name__ == "__main__":
    main()
