"""One-off probe: in a real browser session, which requests load a product's creator videos
(with views, likes, comments) on the TikTok Shop product page?

Stores findings in tiktok_watch.runs (job = 'probe_videos_browser'). Never stores credentials.
"""
from __future__ import annotations

import asyncio
import json
import re

import db
import netstats
from session import setup_logging, tiktok_session


async def main() -> None:
    setup_logging()
    conn = db.connect()
    with conn.cursor() as cur:
        cur.execute("select product_id, url from tiktok_watch.shop_products where url like '%/pdp/%'"
                    " order by last_sold desc nulls last limit 1")
        pid, url = cur.fetchone()
    out = {"product_id": pid, "pages": {}}
    async with tiktok_session() as (api, _):
        page = api.sessions[0].page
        hits = []

        async def on_response(resp):
            try:
                ct = resp.headers.get("content-type", "")
                if "json" not in ct:
                    return
                body = await resp.text()
                if re.search(r'"(play_count|playCount|digg_count|diggCount|aweme_id|video_id)"', body):
                    hits.append({"url": resp.url[:400], "status": resp.status, "bytes": len(body),
                                 "sample": body[:2500]})
                elif "/api/" in resp.url:
                    hits.append({"url": resp.url[:300], "status": resp.status, "bytes": len(body), "sample": ""})
            except Exception as e:  # noqa: BLE001
                hits.append({"url": resp.url[:200], "error": str(e)[:100]})

        page.on("response", lambda r: asyncio.ensure_future(on_response(r)))
        slug_id = url.split("/pdp/", 1)[1].split("?")[0]
        for name, u in [("www_shop_pdp", f"https://www.tiktok.com/shop/pdp/{slug_id}"), ("shop_pdp", url)]:
            hits.clear()
            try:
                await page.goto(u, wait_until="domcontentloaded", timeout=60000)
                await page.wait_for_timeout(6000)
                for _ in range(6):
                    await page.mouse.wheel(0, 2500)
                    await page.wait_for_timeout(1500)
                html = await page.content()
                out["pages"][name] = {
                    "final_url": page.url[:300],
                    "title": (re.search(r"<title>(.*?)</title>", html, re.S) or [None, ""])[1][:200],
                    "video_links": sorted(set(re.findall(r'/@[\w.]+/video/\d+', html)))[:20],
                    "mentions_videos": len(re.findall(r'(?i)videos?\s*\(\d+', html)),
                    "responses": hits[:25],
                }
            except Exception as e:  # noqa: BLE001
                out["pages"][name] = {"error": type(e).__name__ + ": " + str(e)[:300]}
    out.update(netstats.summary())
    run_id = db.start_run(conn, "probe_videos_browser")
    db.finish_run(conn, run_id, True, json.loads(json.dumps(out, default=str)))
    conn.close()


if __name__ == "__main__":
    asyncio.run(main())
