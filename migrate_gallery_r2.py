"""One-off: copy the product gallery images and the creator video covers (base64 webp in tiktok_watch.shop_product_images) to Cloudflare R2.

Step 1 (default): upload every image that has no r2_key yet and record the key; the database copy stays.
Step 2 (--drop-data, only after the website reads from R2): empty the database copy of images that are on R2.
"""
import base64
import sys
from concurrent.futures import ThreadPoolExecutor

import db
import media_store

BATCH = 400


def main():
    conn = db.connect()
    rid = db.start_run(conn, "migrate_gallery_r2")
    stats = {"uploaded": 0, "errors": 0, "dropped": 0}
    if not media_store.enabled():
        db.finish_run(conn, rid, False, stats, "R2 secrets missing")
        return
    if "--drop-data" in sys.argv:
        with conn.cursor() as cur:
            cur.execute("update tiktok_watch.shop_product_images set data = null where r2_key is not null and data is not null")
            stats["dropped"] = cur.rowcount
            cur.execute("update tiktok_watch.shop_product_videos set cover = null where cover_key is not null and cover is not null")
            stats["covers_dropped"] = cur.rowcount
        conn.commit()
        db.finish_run(conn, rid, True, stats)
        return

    def up(row):
        pid, idx, data = row
        key = f"gallery/{pid}/{idx}.webp"
        try:
            media_store.put(key, base64.b64decode(data), "image/webp")
            return pid, idx, key
        except Exception:
            return pid, idx, None

    while True:
        with conn.cursor() as cur:
            cur.execute("select product_id, idx, data from tiktok_watch.shop_product_images where r2_key is null and data is not null limit %s", (BATCH,))
            rows = cur.fetchall()
        if not rows:
            break
        with ThreadPoolExecutor(16) as ex:
            res = list(ex.map(up, rows))
        ok = [(k, p, i) for p, i, k in res if k]
        stats["uploaded"] += len(ok)
        stats["errors"] += len(res) - len(ok)
        with conn.cursor() as cur:
            cur.executemany("update tiktok_watch.shop_product_images set r2_key = %s where product_id = %s and idx = %s", ok)
        conn.commit()
        print(stats, flush=True)
        if not ok:
            break
    # creator video covers (jpeg)
    def up_cover(row):
        pid, item, data = row
        key = f"cover/{pid}/{item}.jpg"
        try:
            media_store.put(key, base64.b64decode(data), "image/jpeg")
            return pid, item, key
        except Exception:
            return pid, item, None
    stats["covers"] = 0
    while True:
        with conn.cursor() as cur:
            cur.execute("select product_id, item_id, cover from tiktok_watch.shop_product_videos where cover_key is null and cover is not null limit %s", (BATCH,))
            rows = cur.fetchall()
        if not rows:
            break
        with ThreadPoolExecutor(16) as ex:
            res = list(ex.map(up_cover, rows))
        ok = [(k, p, i) for p, i, k in res if k]
        stats["covers"] += len(ok)
        stats["errors"] += len(res) - len(ok)
        with conn.cursor() as cur:
            cur.executemany("update tiktok_watch.shop_product_videos set cover_key = %s where product_id = %s and item_id = %s", ok)
        conn.commit()
        print(stats, flush=True)
        if not ok:
            break
    db.finish_run(conn, rid, stats["errors"] == 0, stats)


if __name__ == "__main__":
    main()
