"""One-off probe: what can be discovered on shop.tiktok.com (US) without a browser?

Fetches the shop home page, finds internal link patterns (categories, search, stores, ...),
then fetches a few of each kind and counts product entries in them. Results go to
tiktok_watch.runs (job = 'probe_shop'). Never stores credentials.
"""
from __future__ import annotations

import os
import re
from collections import Counter, defaultdict
from urllib.parse import urljoin, urlparse

import requests

import db
from core import proxy_settings
from fetch_product import _unescape
from fetch_video import HEADERS

BASE = "https://shop.tiktok.com/us"
EXTRA = [
    "https://shop.tiktok.com/us/search?q=gadget",
    "https://shop.tiktok.com/us/search/result?keyword=gadget",
    "https://shop.tiktok.com/us/best-sellers",
    "https://shop.tiktok.com/us/trending",
]


def get(url, proxies):
    try:
        r = requests.get(url, headers=HEADERS, proxies=proxies, timeout=30)
        return r.status_code, r.url, r.text
    except Exception as e:
        return None, url, type(e).__name__ + ": " + str(e)[:150].replace(os.environ.get("PROXY_URL", "~"), "***")


def analyse(url, status, final, html) -> dict:
    out = {"status": status, "final": final[:200], "bytes": len(html or "")}
    if not status:
        out["error"] = html
        return out
    text = _unescape(html)
    out["title"] = (re.search(r"<title>(.*?)</title>", html, re.S) or [None, None])[1]
    pids = set(re.findall(r"/pdp/[^\"'?#\s]*/(\d{15,20})", text)) | set(re.findall(r'"product_id":\s*"?(\d{15,20})', text))
    out["product_ids"] = len(pids)
    out["sold_count_fields"] = len(re.findall(r'"sold_count"', text))
    out["price_fields"] = len(re.findall(r'"(?:min_sku_price|sale_price_decimal|real_price)"', text))
    m = re.search(r'"product_id":\s*"?(\d{15,20})"?.{0,600}', text, re.S)
    out["sample"] = m.group(0)[:600] if m else None
    return out


def main() -> None:
    _, proxies = proxy_settings(os.environ.get("PROXY_URL"))
    results = {}
    conn0 = db.connect()
    with conn0.cursor() as cur:
        cur.execute("select product_url from tiktok_watch.videos where product_url like '%/pdp/%' order by product_sold desc nulls last limit 1")
        seed = cur.fetchone()[0]
    conn0.close()
    status, final, html = get(seed, proxies)
    results["home"] = analyse(seed, status, final, html)
    if status:
        t = _unescape(html)
        results["pdp_other_products"] = len(set(re.findall(r'"product_id":\s*"?(\d{15,20})', t)))
        results["pdp_link_samples"] = sorted(set(re.findall(r'https://shop\.tiktok\.com/us/[a-z\-]+/[^"\s<>]{0,80}', t)))[:40]
        results["pdp_keys"] = sorted(set(re.findall(r'"(\w*(?:recommend|similar|related|store|shop_info|seller)\w*)":', t)))[:60]
    links = set()
    if status:
        for href in re.findall(r'href="([^"]+)"', html):
            u = urljoin(BASE + "/", href)
            if urlparse(u).netloc == "shop.tiktok.com":
                links.add(u.split("#")[0])
    kinds = defaultdict(list)
    for u in sorted(links):
        parts = urlparse(u).path.strip("/").split("/")
        kinds["/".join(parts[:2]) if len(parts) > 1 else parts[0]].append(u)
    results["link_kinds"] = {k: {"count": len(v), "examples": v[:3]} for k, v in sorted(kinds.items(), key=lambda kv: -len(kv[1]))[:25]}
    tried = 0
    for kind, urls in sorted(kinds.items(), key=lambda kv: -len(kv[1])):
        if kind.endswith("pdp") or tried >= 8:
            continue
        u = urls[0]
        results["page:" + u[:160]] = analyse(u, *get(u, proxies))
        tried += 1
    for u in EXTRA:
        results["page:" + u] = analyse(u, *get(u, proxies))
    conn = db.connect()
    run_id = db.start_run(conn, "probe_shop")
    db.finish_run(conn, run_id, True, results)
    conn.close()
    print({k: (v.get("status"), v.get("product_ids")) for k, v in results.items() if isinstance(v, dict) and "status" in v})


if __name__ == "__main__":
    main()
