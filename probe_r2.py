"""Probe: can the workflows write to Cloudflare R2 (termekradar-media)? Writes one small test file and reads it back."""
import os
import time

import db
import media_store

out = {"enabled": media_store.enabled()}
if out["enabled"]:
    try:
        key = "probe/test.txt"
        media_store.put(key, f"ok {time.time()}".encode(), "text/plain")
        obj = media_store.client().get_object(Bucket=os.environ["R2_BUCKET"], Key=key)
        out["read_back"] = obj["Body"].read().decode()[:40]
        out["ok"] = True
    except Exception as e:
        out["error"] = f"{type(e).__name__}: {str(e)[:300]}"
conn = db.connect()
rid = db.start_run(conn, "probe_r2")
db.finish_run(conn, rid, bool(out.get("ok")), out)
print(out)
