"""Probe: run the tr-kit edge function's code (tools/kitlib.mjs, built from it) on a US runner and store the result."""
import json
import os
import subprocess

import db

arg = os.environ.get("VIDEO_URLS", "").strip()
p = subprocess.run(["node", "tools/kit_test.mjs"] + ([arg] if arg else []), capture_output=True, text=True, timeout=600)
try:
    out = json.loads(p.stdout.strip().splitlines()[-1])
except Exception:  # noqa: BLE001
    out = {"stdout": p.stdout[-3000:], "stderr": p.stderr[-3000:]}
conn = db.connect()
rid = db.start_run(conn, "probe_kit3")
db.finish_run(conn, rid, True, out)
print(json.dumps(out)[:3000])
