"""Probe: product reviews through a real browser."""
import asyncio
import json
import time

from playwright.async_api import async_playwright

import db
import reviews

PID = "1731603196057654264"


async def main():
    out = {}
    t = time.time()
    async with async_playwright() as pw:
        browser, page = await reviews.open_shop_page(pw, f"https://shop.tiktok.com/us/pdp/x/{PID}")
        out["cookies"] = [c["name"] for c in await page.context.cookies()]
        res = await reviews.fetch_reviews(page, PID)
        await browser.close()
    rv = res["reviews"]
    out.update(seconds=round(time.time() - t), n=len(rv), summary=res["summary"], errors=res["errors"][:10],
               by_star={s: sum(1 for r in rv if r["rating"] == s) for s in range(1, 6)},
               with_img=sum(1 for r in rv if r["images"]),
               img_query=(next((r["images"][0] for r in rv if r["images"]), "").split("?")[1][:300] if any(r["images"] for r in rv) else None),
               sample=[(r["rating"], (r["text"] or "")[:150], r["sku"]) for r in rv[:5]])
    print(json.dumps(out, indent=1))
    conn = db.connect()
    rid = db.start_run(conn, "probe_reviews_browser")
    db.finish_run(conn, rid, True, out)

asyncio.run(main())
