"""Probe: list every TikTok Shop product linked to the videos in VIDEO_URLS (comma separated)."""
import json
import os
import re

import db
from core import _json_maybe, _shop_product
from fetch_video import fetch_video

urls = [u.strip() for u in os.environ.get("VIDEO_URLS", "").split(",") if u.strip()]
proxy = os.environ.get("PROXY_URL")
proxies = {"http": proxy, "https": proxy} if proxy else None
out = {}
for url in urls:
    vid = re.search(r"/video/(\d+)", url).group(1)
    try:
        item = fetch_video(url, vid, proxies)
    except Exception as e:  # noqa: BLE001
        out[vid] = {"error": str(e)}
        continue
    prods = []
    for anchor in item.get("anchors") or []:
        for it in _json_maybe((anchor or {}).get("extra")) or []:
            if isinstance(it, dict) and str(it.get("type")) == "33":
                inner = _json_maybe(it.get("extra"))
                p = _shop_product(inner) if isinstance(inner, dict) else None
                if p:
                    prods.append(p)
    out[vid] = {"desc": (item.get("desc") or "")[:200], "anchors": len(item.get("anchors") or []), "products": prods}
print(json.dumps(out, indent=1))
conn = db.connect()
rid = db.start_run(conn, "probe_video_products")
db.finish_run(conn, rid, True, out)
