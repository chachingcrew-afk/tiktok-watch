"""One-off: re-run the comment filter over the stored comments (after a filter fix).

Comments the filter no longer keeps are removed (a copy is in backup_20261030.video_comments_20261119),
the others get their new tags. Kits from the first run are marked so the next comments run retries
the videos that answered empty.
"""
import json

import db
from comment_filter import classify

conn = db.connect()
rid = db.start_run(conn, "reclassify_comments")
with conn.cursor() as cur:
    cur.execute("select comment_id, text, tags from tiktok_watch.video_comments")
    rows = cur.fetchall()
    dropped = changed = 0
    for cid, text, tags in rows:
        new = classify(text)
        if not new:
            cur.execute("delete from tiktok_watch.video_comments where comment_id = %s", (cid,))
            dropped += 1
        elif list(tags or []) != new:
            cur.execute("update tiktok_watch.video_comments set tags = %s where comment_id = %s", (new, cid))
            changed += 1
    cur.execute("""update tiktok_watch.kits k set comments_stats = coalesce(k.comments_stats, '{}'::jsonb) || jsonb_build_object(
                     'done', coalesce((select jsonb_agg(distinct c.video_id) from tiktok_watch.video_comments c where c.product_id = k.product_id), '[]'::jsonb),
                     'pending', 1, 'tries', 1,
                     'kept', (select count(*) from tiktok_watch.video_comments c where c.product_id = k.product_id))
                   where k.comments_at is not null and k.deleted_at is null and not (coalesce(k.comments_stats, '{}'::jsonb) ? 'done')""")
conn.commit()
out = {"rows": len(rows), "dropped": dropped, "changed": changed}
db.finish_run(conn, rid, True, out)
print(json.dumps(out))
