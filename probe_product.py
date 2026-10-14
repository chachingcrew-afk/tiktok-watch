"""One-off probe: fetch a few TikTok Shop product pages through the proxy and record what data they contain.

Results go to tiktok_watch.runs (job = 'probe_product') so the page structure can be inspected
without access to the GitHub log. Never stores credentials.
"""
from __future__ import annotations

import json
import os
import re

import requests

import db
from core import proxy_settings
from fetch_video import HEADERS

KEYWORDS = ["\"price\"", "sale_price", "real_price", "min_price", "sold_count", "\"sold\"", "format_price",
            "application/ld+json", "__MODERN_ROUTER_DATA__", "__UNIVERSAL_DATA_FOR_REHYDRATION__", "SIGI_STATE",
            "\"offers\"", "lowPrice"]


def probe(url: str, proxies) -> dict:
    out = {"url": url}
    try:
        r = requests.get(url, headers=HEADERS, proxies=proxies, timeout=30, allow_redirects=True)
    except Exception as e:
        out["error"] = type(e).__name__ + ": " + str(e)[:200].replace(os.environ.get("PROXY_URL", "~"), "***")
        return out
    html = r.text
    out.update(status=r.status_code, final_url=r.url[:300], bytes=len(html),
               title=(re.search(r"<title>(.*?)</title>", html, re.S) or [None, None])[1])
    out["markers"] = {k: html.count(k) for k in KEYWORDS}
    snippets = {}
    for k in ("\"price\"", "sale_price", "sold_count", "format_price", "lowPrice", "\"offers\""):
        i = html.find(k)
        if i != -1:
            snippets[k] = html[max(0, i - 120): i + 280]
    out["snippets"] = snippets
    ld = re.findall(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', html, re.S)
    out["ld_json"] = [s[:1500] for s in ld[:3]]
    return out


def main() -> None:
    _, req = proxy_settings(os.environ.get("PROXY_URL"))
    conn = db.connect()
    with conn.cursor() as cur:
        cur.execute("select product_id, product_url from tiktok_watch.videos where product_url is not null limit 3")
        rows = cur.fetchall()
    results = {pid: probe(url, req) for pid, url in rows}
    run_id = db.start_run(conn, "probe_product")
    db.finish_run(conn, run_id, True, results)
    conn.close()
    print(json.dumps({k: {kk: v.get(kk) for kk in ("status", "bytes", "title", "markers")} for k, v in results.items()}, indent=1))


if __name__ == "__main__":
    main()
