"""One-off probe of TikTok Shop category pages: product JSON shape, pagination and no-proxy access.

Stores findings in tiktok_watch.runs (job = 'probe_category'). Never stores credentials.
"""
from __future__ import annotations

import os
import re

import requests

import db
from core import proxy_settings
from fetch_product import _unescape
from fetch_video import HEADERS

CAT = "https://shop.tiktok.com/us/c/kitchen-utensils-gadgets/{id}"


def get(url, proxies):
    try:
        r = requests.get(url, headers=HEADERS, proxies=proxies, timeout=30)
        return r.status_code, r.url, r.text
    except Exception as e:
        return None, url, type(e).__name__ + ": " + str(e)[:150].replace(os.environ.get("PROXY_URL", "~"), "***")


def ids(text):
    return re.findall(r'"product_id":\s*"?(\d{15,20})', text)


def main() -> None:
    _, proxies = proxy_settings(os.environ.get("PROXY_URL"))
    out = {}
    conn = db.connect()
    with conn.cursor() as cur:
        cur.execute("select product_url from tiktok_watch.videos where product_url like '%/pdp/%' limit 1")
        seed = cur.fetchone()[0]
    st, fin, html = get(seed, proxies)
    t = _unescape(html or "")
    cats = sorted(set(re.findall(r'https://shop\.tiktok\.com/us/c/([a-z0-9\-]+)/(\d+)', t)))
    out["categories"] = [f"{s}/{i}" for s, i in cats]

    # pick a category with likely dropshipping products
    pick = next((c for c in cats if "kitchen" in c[0]), cats[0] if cats else None)
    if pick:
        base = f"https://shop.tiktok.com/us/c/{pick[0]}/{pick[1]}"
        st, fin, html = get(base, proxies)
        t = _unescape(html or "")
        p1 = ids(t)
        out["page1"] = {"url": base, "status": st, "bytes": len(html or ""), "ids": len(set(p1)), "id_list": list(dict.fromkeys(p1))[:40]}
        i = t.find('"product_id"')
        out["page1_excerpt"] = t[max(0, i - 1500): i + 3500] if i != -1 else t[:3000]
        out["page1_keys"] = sorted(set(re.findall(r'"(\w*(?:page|cursor|offset|has_more|total|sort|next)\w*)":', t)))[:60]
        out["page1_links"] = sorted(set(re.findall(re.escape(base) + r'[^"\s<>]{0,60}', t)))[:20]
        for suffix in ["?page=2", "/2", "?offset=20", "?page_index=2", "?sort=sales"]:
            st2, fin2, h2 = get(base + suffix, proxies)
            p = list(dict.fromkeys(ids(_unescape(h2 or ""))))
            out["try" + suffix] = {"status": st2, "final": fin2[:160], "ids": len(p), "new_vs_page1": len(set(p) - set(p1))}
        stn, finn, hn = get(base, None)
        tn = _unescape(hn or "")
        out["no_proxy"] = {"status": stn, "bytes": len(hn or ""), "ids": len(set(ids(tn))),
                           "title": (re.search(r"<title>(.*?)</title>", hn or "", re.S) or [None, None])[1]}
    run_id = db.start_run(conn, "probe_category")
    db.finish_run(conn, run_id, True, out)
    conn.close()


if __name__ == "__main__":
    main()
