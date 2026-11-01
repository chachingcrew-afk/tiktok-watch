"""Probe for the product kit page: what a product page gives (description, specs, size chart, colors,
gallery), the creator video list, and whether a creator video's mp4 can be downloaded without a browser.
Product id from VIDEO_URLS (default: the OYS satin dress). Result goes to the runs table."""
import json
import os
import re

import requests

import db
from fetch_product import _unescape
from fetch_video import HEADERS
from gallery import gallery_urls
import product_videos as pv

PID = os.environ.get("VIDEO_URLS", "").strip() or "1729467441089778277"
out = {}
r = requests.get(f"https://shop.tiktok.com/us/pdp/x/{PID}", headers={**HEADERS, "Accept-Language": "en-US,en;q=0.9"}, timeout=30)
t = _unescape(r.text)
out["status"] = r.status_code


def around(key, before=200, after=3000):
    i = t.find(key)
    return t[max(0, i - before):i + after] if i >= 0 else None


for key in ['"desc_detail"', '"description"', '"product_property"', '"specifications"', '"product_properties"',
            '"size_chart"', '"size_guide"', '"sizeChart"', '"size_info"', '"rating"', '"review_count"', '"product_rating"']:
    out[key] = around(key, 100, 1500)
out["gallery"] = gallery_urls(r.text)[:12]
out["keys_sample"] = sorted(set(re.findall(r'"([a-z_]{6,40})":', t)))[:600]

# creator videos for the product
try:
    vids = pv.fetch_videos(PID, None, f"https://shop.tiktok.com/us/pdp/x/{PID}")
    out["videos"] = [{k: v for k, v in x.items() if k != "upload_time"} for x in vids[:5]]
except Exception as e:  # noqa: BLE001
    out["videos_error"] = str(e)
    vids = []

# can we download one video file?
if vids:
    v = vids[0]
    s = requests.Session()
    page = s.get(f"https://www.tiktok.com/@{v.get('author_name') or '_'}/video/{v['item_id']}", headers=HEADERS, timeout=30)
    info = {"page_status": page.status_code, "len": len(page.text)}
    m = re.search(r'<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)</script>', page.text)
    if m:
        item = (json.loads(m.group(1)).get("__DEFAULT_SCOPE__", {}).get("webapp.video-detail", {}).get("itemInfo", {}).get("itemStruct") or {})
        video = item.get("video") or {}
        info["fields"] = sorted(video.keys())
        for key in ("playAddr", "downloadAddr"):
            u = video.get(key)
            info[key] = (u or "")[:200]
            if u:
                try:
                    vr = s.get(u, headers={**HEADERS, "Referer": "https://www.tiktok.com/", "Range": "bytes=0-"}, timeout=60)
                    info[key + "_status"] = vr.status_code
                    info[key + "_bytes"] = len(vr.content)
                    info[key + "_type"] = vr.headers.get("content-type")
                except Exception as e:  # noqa: BLE001
                    info[key + "_error"] = str(e)[:200]
        bi = video.get("bitrateInfo") or []
        info["bitrate_urls"] = len(bi)
        info["cookies"] = sorted(s.cookies.keys())
    out["download"] = info

conn = db.connect()
rid = db.start_run(conn, "probe_kit")
db.finish_run(conn, rid, True, out)
print(json.dumps(out, indent=1)[:3000])
