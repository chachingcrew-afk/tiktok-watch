"""One-off probe: does TikTok oEmbed give a cover image for a video id without the creator handle?"""
from __future__ import annotations

import requests

import db
from fetch_video import HEADERS


def main() -> None:
    conn = db.connect()
    with conn.cursor() as cur:
        cur.execute("select item_id, source from tiktok_watch.shop_product_videos where source='page' order by play_count desc limit 2")
        rows = cur.fetchall()
        cur.execute("select video_id, author from tiktok_watch.videos order by first_seen desc limit 1")
        fv = cur.fetchone()
    out = {}
    tests = [(f"https://www.tiktok.com/@/video/{rows[0][0]}", "no_handle"), (f"https://www.tiktok.com/video/{rows[1][0]}", "no_at"),
             (f"https://www.tiktok.com/@{fv[1]}/video/{fv[0]}", "with_handle")]
    for u, name in tests:
        try:
            r = requests.get("https://www.tiktok.com/oembed", params={"url": u}, headers={"User-Agent": HEADERS["User-Agent"]}, timeout=20)
            j = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            thumb = j.get("thumbnail_url")
            ok_img = None
            if thumb:
                ir = requests.get(thumb, headers={"User-Agent": HEADERS["User-Agent"]}, timeout=20)
                ok_img = [ir.status_code, len(ir.content)]
            out[name] = {"status": r.status_code, "keys": list(j.keys())[:15], "thumb": (thumb or "")[:160], "img": ok_img,
                         "cors": r.headers.get("access-control-allow-origin")}
        except Exception as e:  # noqa: BLE001
            out[name] = {"error": str(e)[:200]}
    run_id = db.start_run(conn, "probe_oembed")
    db.finish_run(conn, run_id, True, out)
    conn.close()


if __name__ == "__main__":
    main()
