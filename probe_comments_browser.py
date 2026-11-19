"""Probe: can we read the comments of a product's creator videos (TikTokApi, same session as the collector)?

Takes the 3 most played creator videos of the first product kit, reads up to 150 comments of each,
and records counts, timing and a sample of texts in tiktok_watch.runs (job 'probe_comments').
"""
import asyncio
import json
import time

import db
from session import setup_logging, tiktok_session

PER_VIDEO = 150


async def main() -> None:
    setup_logging()
    conn = db.connect()
    rid = db.start_run(conn, "probe_comments")
    with conn.cursor() as cur:
        cur.execute("""select product_id, data->'videos' from tiktok_watch.kits
                       where deleted_at is null and jsonb_array_length(coalesce(data->'videos','[]')) > 0
                       order by created_at limit 1""")
        pid, vids = cur.fetchone()
    vids = sorted(vids or [], key=lambda v: -(v.get("plays") or 0))[:3]
    out = {"product_id": pid, "videos": []}
    try:
        async with tiktok_session() as (api, _):
            for v in vids:
                t0, got, err = time.time(), [], None
                try:
                    async for c in api.video(id=str(v["item_id"])).comments(count=PER_VIDEO):
                        d = c.as_dict
                        got.append({"text": d.get("text"), "likes": d.get("digg_count"), "replies": d.get("reply_comment_total"),
                                    "time": d.get("create_time"), "lang": d.get("comment_language")})
                        if len(got) >= PER_VIDEO:
                            break
                except Exception as e:  # record and go on
                    err = f"{type(e).__name__}: {str(e)[:200]}"
                out["videos"].append({"item_id": v["item_id"], "plays": v.get("plays"), "n": len(got), "sec": round(time.time() - t0, 1),
                                      "error": err, "keys": sorted((got and list(d.keys())) or []) if False else None,
                                      "sample": got[:40]})
        db.finish_run(conn, rid, True, out)
    except Exception as e:
        db.finish_run(conn, rid, False, out, f"{type(e).__name__}: {str(e)[:300]}")
        raise
    print(json.dumps({k: (v if k != "videos" else [{x: y for x, y in vv.items() if x != "sample"} for vv in v]) for k, v in out.items()}))


if __name__ == "__main__":
    asyncio.run(main())
