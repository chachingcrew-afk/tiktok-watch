"""Probe: which proxy provider is configured (host and port only, never the credentials)."""
import os
from urllib.parse import urlparse

import db

p = urlparse(os.environ.get("PROXY_URL", "") or "")
out = {"proxy_set": bool(p.hostname), "host": p.hostname, "port": p.port, "scheme": p.scheme}
conn = db.connect()
rid = db.start_run(conn, "probe_proxy_host")
db.finish_run(conn, rid, True, out)
print(out)
