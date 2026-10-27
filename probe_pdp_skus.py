"""Probe: a product page's options (colors, sizes), prices per variant, description and image links."""
import json
import os
import re

import requests

import db
from fetch_product import _unescape
from fetch_video import HEADERS
from gallery import gallery_urls

PID = os.environ.get("VIDEO_URLS", "").strip() or "1729467441089778277"
r = requests.get(f"https://shop.tiktok.com/us/pdp/x/{PID}", headers={**HEADERS, "Accept-Language": "en-US,en;q=0.9"}, timeout=30)
t = _unescape(r.text)
out = {"status": r.status_code, "len": len(r.text), "images": gallery_urls(r.text)[:12]}


def block(key, n=6000):
    i = t.find(key)
    return t[i:i + n] if i >= 0 else None


sp = block('"sale_props"', 200000) or ""
colors, sizes, prices = [], [], {}
for m in re.finditer(r'"sku_sale_props":\[(.*?)\],"price":\{(.*?)\}', block('"skus"', 400000) or ""):
    props = dict(re.findall(r'"prop_name":"([^"]+)","prop_value_id":"\d+","prop_value":"([^"]+)"', m.group(1)))
    c, z = props.get("Color"), props.get("Size")
    if c and c not in colors: colors.append(c)
    if z and z not in sizes: sizes.append(z)
    pr = re.search(r'"sale_price_decimal":"([\d.]+)"', m.group(2)); op = re.search(r'"origin_price_decimal":"([\d.]+)"', m.group(2))
    prices[f"{c}|{z}"] = [pr.group(1) if pr else None, op.group(1) if op else None]
out["colors"], out["sizes"], out["prices"] = colors, sizes, prices
cimg = {}
for m in re.finditer(r'"prop_value":"([^"]+)","image":\{"width":\d+,"height":\d+,"uri":"[^"]+","url_list":\["([^"]+)"', sp):
    cimg.setdefault(m.group(1), m.group(2).replace("\\u002F", "/"))
out["color_images"] = cimg
out["sale_props"] = sp[:3000]
out["skus"] = block('"skus"', 9000)
out["desc"] = block('"desc_detail"', 4000) or block('"description"', 3000)
out["title"] = (re.search(r'<title>([^<]*)</title>', r.text) or [None, None])[1]
print(json.dumps({k: (v[:500] if isinstance(v, str) else v) for k, v in out.items()}, indent=1))
conn = db.connect()
rid = db.start_run(conn, "probe_pdp_skus")
db.finish_run(conn, rid, True, out)
