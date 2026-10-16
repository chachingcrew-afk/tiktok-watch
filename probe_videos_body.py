"""One-off probe: which page_data request body returns a product's related videos?"""
from __future__ import annotations

import json

import requests

import db
from fetch_video import HEADERS
from product_videos import API, parse_videos, request_body


def post(body, url):
    r = requests.post(API, data=body, timeout=30, headers={**HEADERS, "Content-Type": "application/json",
                      "Origin": "https://shop.tiktok.com", "Referer": url})
    try:
        j = r.json()
        return {"status": r.status_code, "code": j.get("code"), "videos": len(parse_videos(j)), "len": len(r.text),
                "comp_types": [c.get("component_type") for c in (j.get("data") or {}).get("components_map") or []][:8]}
    except ValueError:
        return {"status": r.status_code, "start": r.text[:200]}


def main() -> None:
    conn = db.connect()
    with conn.cursor() as cur:
        cur.execute("select stats->'calls'->0->>'post' from tiktok_watch.runs where job='probe_pagedata' order by id desc limit 1")
        tpl = cur.fetchone()[0]
        cur.execute("select product_id, seller_id, url from tiktok_watch.shop_products where url like '%/pdp/%' and seller_id is not null"
                    " order by last_sold desc nulls last offset 5 limit 2")
        prods = cur.fetchall()
    old_pid, old_seller = "1729404610250642058", "7495309564091468426"
    out = {"n_products": len(prods)}
    try:
        _main(tpl, prods, old_pid, old_seller, out)
    except Exception as e:  # noqa: BLE001
        import traceback
        out["error"] = traceback.format_exc()[-1500:]
    run_id = db.start_run(conn, "probe_videos_body")
    db.finish_run(conn, run_id, True, out)
    conn.close()


def _main(tpl, prods, old_pid, old_seller, out):
    cfg_full = json.loads(json.loads(tpl)["page_config"])
    for pid, seller, url in prods:
        res = {}
        res["A_full_template"] = post(tpl.replace(old_pid, pid).replace(old_seller, seller), url)
        cfg = json.loads(json.dumps(cfg_full).replace(old_pid, pid).replace(old_seller, seller))
        only_video = dict(cfg, components_map=[c for c in cfg["components_map"] if c["component_type"] == "video_list"])
        res["B_video_only_with_globals"] = post(json.dumps({"page_config": json.dumps(only_video)}), url)
        no_cats = json.loads(json.dumps(only_video))
        no_cats["global_data"]["product_info"].pop("categories", None)
        res["C_video_only_no_categories"] = post(json.dumps({"page_config": json.dumps(no_cats)}), url)
        res["D_minimal"] = post(request_body(pid, seller), url)
        out[pid] = res


if __name__ == "__main__":
    main()
