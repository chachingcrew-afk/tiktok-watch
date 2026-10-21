"""Probe: can the review API be read from GitHub's IP / through the proxy?"""
import json
import os

import requests

import db
from fetch_video import HEADERS

PID, SID = "1731603196057654264", "7495967877181377528"
URL = "https://shop.tiktok.com/api/shop/pdp_desktop/get_product_reviews"
proxy = os.environ.get("PROXY_URL")
out = {}


def call(name, extra=None, proxies=None, sess=None):
    body = {"product_id": PID, "page_start": 1, "page_size": 20, "sort_rule": 1,
            "review_filter": {"filter_type": 0, "filter_value": 0}, "component_name": "product_review", **(extra or {})}
    try:
        r = (sess or requests).post(URL, json=body, proxies=proxies, timeout=30, headers={
            **HEADERS, "Accept": "application/json, text/plain, */*", "Origin": "https://shop.tiktok.com",
            "Referer": f"https://shop.tiktok.com/us/pdp/x/{PID}"})
        j = r.json()
        out[name] = {"status": r.status_code, "code": j.get("code"), "n": len((j.get("data") or {}).get("product_reviews") or [])}
    except Exception as e:  # noqa: BLE001
        out[name] = str(e)[:200]


for i in range(3):
    call(f"direct{i}")
call("direct_seller", {"seller_id": SID})
s = requests.Session()
s.get(f"https://shop.tiktok.com/us/pdp/x/{PID}", headers=HEADERS, timeout=30)
out["cookies"] = list(s.cookies.keys())
call("direct_session", sess=s)
if proxy:
    px = {"http": proxy, "https": proxy}
    for i in range(3):
        call(f"proxy{i}", proxies=px)
    s2 = requests.Session()
    s2.get(f"https://shop.tiktok.com/us/pdp/x/{PID}", headers=HEADERS, timeout=30, proxies=px)
    call("proxy_session", proxies=px, sess=s2)
print(json.dumps(out, indent=1))
conn = db.connect()
rid = db.start_run(conn, "probe_reviews")
db.finish_run(conn, rid, True, out)
