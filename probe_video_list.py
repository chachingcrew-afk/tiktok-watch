"""One-off probe: what else does the video_list component return (paging, sorting, totals)?"""
from __future__ import annotations

import json

import requests

import db
from fetch_video import HEADERS
from product_videos import API, request_body


def post(body, url):
    r = requests.post(API, data=body, timeout=30, headers={**HEADERS, "Content-Type": "application/json", "Origin": "https://shop.tiktok.com", "Referer": url})
    return r.json()


def main() -> None:
    conn = db.connect()
    with conn.cursor() as cur:
        cur.execute("select product_id, seller_id, url from tiktok_watch.shop_products where video_count >= 15 order by last_sold desc limit 2")
        prods = cur.fetchall()
    out = {}
    for pid, seller, url in prods:
        res = {}
        j = post(request_body(pid, seller), url)
        for comp in (j.get("data") or {}).get("components_map") or []:
            cd = comp.get("component_data")
            if isinstance(cd, dict):
                res["keys"] = {k: (v if not isinstance(v, (list, dict)) else f"<{type(v).__name__} {len(v)}>") for k, v in cd.items()}
                vids = cd.get("related_videos") or []
                res["upload_times"] = sorted(int(v.get("upload_time") or 0) for v in vids)[-5:]
                res["video_keys"] = sorted(vids[0].keys()) if vids else []
        # try paging / sorting hints
        for name, extra in [("page2", {"cursor": "20", "count": 20, "offset": 20}), ("newest", {"sort_type": 2, "sort_by": "time", "count": 20})]:
            cfg = json.loads(json.loads(request_body(pid, seller))["page_config"])
            cfg["components_map"][0]["fe_config"]["data_source"]["params"] = extra
            j2 = post(json.dumps({"page_config": json.dumps(cfg)}), url)
            vids2 = []
            for comp in (j2.get("data") or {}).get("components_map") or []:
                cd = comp.get("component_data")
                if isinstance(cd, dict):
                    vids2 = cd.get("related_videos") or []
            res[name] = {"code": j2.get("code"), "n": len(vids2), "max_upload": max([int(v.get("upload_time") or 0) for v in vids2] or [0]),
                         "same_first": bool(vids2) and vids2[0].get("item_id") == (vids or [{}])[0].get("item_id")}
        out[pid] = res
    run_id = db.start_run(conn, "probe_video_list")
    db.finish_run(conn, run_id, True, out)
    conn.close()


if __name__ == "__main__":
    main()
