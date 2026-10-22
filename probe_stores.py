"""Probe: store pages by seller id, with and without the right name in the link."""
import json

import db
import stores
from shop import parse_category_page

out = {}
for name, url in [("right_slug", "https://shop.tiktok.com/us/store/eojn/7495967877181377528"),
                  ("dummy_slug", "https://shop.tiktok.com/us/store/s/7495967877181377528")]:
    try:
        html = stores.fetch_store(url)
        info = stores.parse_store(html)
        prods = parse_category_page(html)
        out[name] = {"info": info, "n": len(prods), "top": [(p["sold"], p["price"], p["seller_id"]) for p in prods[:5]]}
    except Exception as e:  # noqa: BLE001
        out[name] = repr(e)[:200]
print(json.dumps(out, indent=1))
conn = db.connect()
rid = db.start_run(conn, "probe_stores")
db.finish_run(conn, rid, True, out)
