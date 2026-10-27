"""Probe: does the edge function see TikTok shop anchors when run in a US region?"""
import json

import requests

import db

URL = "https://sapxyvfiqyshwnwarctj.supabase.co/functions/v1/tr-probe?k=dbg-7f3a"
out = {}
for name, hdr in [("default", {}), ("us-east-1", {"x-region": "us-east-1"}), ("us-west-1", {"x-region": "us-west-1"})]:
    try:
        r = requests.get(URL, headers=hdr, timeout=60)
        out[name] = r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text[:200]
    except Exception as e:  # noqa: BLE001
        out[name] = repr(e)[:200]
print(json.dumps(out, indent=1))
conn = db.connect()
rid = db.start_run(conn, "probe_edge_region")
db.finish_run(conn, rid, True, out)
