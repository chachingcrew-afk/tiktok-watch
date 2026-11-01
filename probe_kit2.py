"""Probe: where the product page keeps its data (script tags), and the shape of the parts the kit needs."""
import json
import os
import re

import requests

import db
from fetch_video import HEADERS

PID = os.environ.get("VIDEO_URLS", "").strip() or "1729467441089778277"
r = requests.get(f"https://shop.tiktok.com/us/pdp/x/{PID}", headers={**HEADERS, "Accept-Language": "en-US,en;q=0.9"}, timeout=30)
html = r.text
out = {"scripts": []}
for m in re.finditer(r'<script([^>]*)>([\s\S]*?)</script>', html):
    attrs, body = m.group(1), m.group(2)
    if len(body) > 2000:
        out["scripts"].append({"attrs": attrs[:200], "len": len(body), "head": body[:200]})


def find_paths(obj, keys, path="", hits=None, depth=0):
    hits = hits if hits is not None else {}
    if depth > 40:
        return hits
    if isinstance(obj, dict):
        for k, v in obj.items():
            p = f"{path}.{k}"
            if k in keys and k not in hits:
                hits[k] = {"path": p, "sample": json.dumps(v)[:2500]}
            find_paths(v, keys, p, hits, depth + 1)
    elif isinstance(obj, list):
        for i, v in enumerate(obj[:50]):
            find_paths(v, keys, f"{path}[{i}]", hits, depth + 1)
    elif isinstance(obj, str) and len(obj) > 200 and obj[:1] in "{[":
        try:
            find_paths(json.loads(obj), keys, path + "<json>", hits, depth + 1)
        except ValueError:
            pass
    return hits


KEYS = {"specifications", "desc_blocks", "sale_props", "skus", "review", "product_base", "title", "images", "product_id", "seller", "shop_info"}
for m in re.finditer(r'<script([^>]*)>([\s\S]*?)</script>', html):
    body = m.group(2).strip()
    if len(body) < 5000:
        continue
    cand = body
    if not cand.startswith("{"):
        i = cand.find("{")
        cand = cand[i:].rstrip(";") if i >= 0 else ""
    try:
        data = json.loads(cand)
    except ValueError:
        continue
    out.setdefault("parsed", []).append({"attrs": m.group(1)[:200], "hits": find_paths(data, KEYS)})

conn = db.connect()
rid = db.start_run(conn, "probe_kit2")
db.finish_run(conn, rid, True, out)
print(json.dumps(out)[:2000])
