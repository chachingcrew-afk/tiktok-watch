"""Probe: what does the Ad Library load while scrolling? Records each GraphQL call's name, size and whether it holds ads."""
import asyncio, json, os, re
from urllib.parse import parse_qs
from playwright.async_api import async_playwright
import db

URL = ("https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&is_targeted_country=false"
       "&media_type=all&q=posture%20corrector&search_type=keyword_unordered")

async def main():
    calls = []
    async with async_playwright() as pw:
        b = await pw.chromium.launch(headless=True)
        page = await (await b.new_context(locale="en-US", viewport={"width": 1280, "height": 900})).new_page()
        async def on_resp(r):
            if "/api/graphql" in r.url:
                name = None
                try:
                    pd = r.request.post_data or ""
                    name = (parse_qs(pd).get("fb_api_req_friendly_name") or [None])[0]
                except Exception:
                    pass
                try:
                    t = await asyncio.wait_for(r.text(), 15)
                except Exception as e:
                    t = f"ERR {e}"
                calls.append({"name": name, "len": len(t), "ads": t.count('"ad_archive_id"'), "start": t[:80]})
        page.on("response", on_resp)
        await page.goto(URL, wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_timeout(6000)
        html = await page.content()
        first = html.count('"ad_archive_id"')
        heights = []
        for i in range(8):
            for _ in range(4):
                await page.mouse.wheel(0, 2500)
                await page.wait_for_timeout(700)
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await page.wait_for_timeout(3500)
            heights.append(await page.evaluate("document.body.scrollHeight"))
        cards = await page.evaluate("document.querySelectorAll('[class*=x1plvlek]').length")
        text = await page.inner_text("body")
        out = {"html_ads": first, "calls": calls[-25:], "heights": heights, "library_ids_in_text": len(re.findall(r"Library ID", text))}
        await b.close()
    conn = db.connect(); rid = db.start_run(conn, "probe_fbpage"); db.finish_run(conn, rid, True, out)
    print(json.dumps(out)[:3000])

asyncio.run(main())
