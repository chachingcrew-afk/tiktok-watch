"""One-off / catch-up: copy the creatives of Facebook ads already in the database to R2 (fbads.store_media),
newest first, while Facebook's links still work."""
import db
import fbads
from core import proxy_settings
import os

conn = db.connect()
rid = db.start_run(conn, "fbads_media")
_, proxies = proxy_settings(os.environ.get("PROXY_URL"))
with conn.cursor() as cur:
    cur.execute("""select ad_archive_id, image_url, video_url, video_preview, start_date, collation_count,
                          (page_id in (select page_id from tiktok_watch.fb_pages)) watched
                   from tiktok_watch.fb_ads
                   where last_seen > now() - interval '3 days' and (image_key is null and image_url is not null
                         or poster_key is null and video_preview is not null or video_key is null and video_url is not null)
                   order by last_seen desc""")
    rows = cur.fetchall()
for i in range(0, len(rows), 60):
    chunk = rows[i:i + 60]
    for watched in (True, False):
        ads = [{"id": r[0], "image": r[1], "video": r[2], "preview": r[3], "start": r[4], "collation_count": r[5]} for r in chunk if r[6] == watched]
        fbads.store_media(conn, ads, proxies, watched)
    print(i, dict(fbads.STATS), flush=True)
db.finish_run(conn, rid, True, {"ads": len(rows), **fbads.STATS})
