"""Probe: what a TikTok Shop store page tells us (store sales, product list, paging)."""
import json
import os
import re

import requests

import db
from fetch_video import HEADERS
from shop import _unescape, parse_category_page

PID = "1731603196057654264"  # EOJN tights
proxy = os.environ.get("PROXY_URL")
out = {}


def get(url):
    for via in (None, {"http": proxy, "https": proxy} if proxy else None):
        try:
            r = requests.get(url, headers={**HEADERS, "Accept-Language": "en-US,en;q=0.9"}, proxies=via, timeout=30)
            if r.status_code == 200 and len(r.text) > 5000:
                return r.text, ("proxy" if via else "direct")
        except Exception:  # noqa: BLE001
            pass
    return "", None


html, how = get(f"https://shop.tiktok.com/us/pdp/x/{PID}")
t = _unescape(html)
out["pdp_len"], out["pdp_via"] = len(html), how
out["store_links"] = sorted(set(re.findall(r'https?://shop\.tiktok\.com/us/store/[^"\s<>]+', t)))[:5] + sorted(set(re.findall(r'"/us/store/[^"]+"', t)))[:5]
i = t.find('"shop_name"')
out["shop_ctx"] = t[max(0, i - 1500):i + 2500] if i >= 0 else None
store = None
for link in out["store_links"]:
    link = link.strip('"')
    store = link if link.startswith("http") else "https://shop.tiktok.com" + link
    break
if store:
    sh, how2 = get(store)
    st = _unescape(sh)
    prods = parse_category_page(sh)
    out["store_url"], out["store_len"], out["store_via"] = store, len(sh), how2
    out["store_products"] = len(prods)
    out["store_sample"] = [(p["title"][:60] if p["title"] else None, p["price"], p["sold"]) for p in prods[:8]]
    out["store_keys"] = sorted(set(re.findall(r'"([a-z_]*(?:sold|sale|cursor|has_more|page_token|offset|total|follower)[a-z_]*)"\s*:', st)))[:80]
    j = st.find('"has_more"')
    out["has_more_ctx"] = st[max(0, j - 600):j + 400] if j >= 0 else None
    k = st.find('sold_count')
    out["first_sold_ctx"] = st[max(0, k - 1200):k + 300] if k >= 0 else None
    out["api_paths"] = sorted(set(re.findall(r'/api/shop/[a-z_/]+', st)))[:40]
print(json.dumps({k: (v[:300] if isinstance(v, str) else v) for k, v in out.items()}, indent=1))
conn = db.connect()
rid = db.start_run(conn, "probe_store")
db.finish_run(conn, rid, True, out)
