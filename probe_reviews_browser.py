"""Probe: which way of calling the review API works from a browser session."""
import asyncio
import json
import logging

from playwright.async_api import async_playwright

import db
import reviews

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
PID = "1731603196057654264"
BODY = {"product_id": PID, "page_start": 1, "page_size": 20, "sort_rule": 2,
        "review_filter": {"filter_type": 1, "filter_value": 1}, "component_name": "product_review"}
JS_XHR = """
(body) => new Promise((res) => {
  const x = new XMLHttpRequest();
  x.open('POST', '/api/shop/pdp_desktop/get_product_reviews');
  x.setRequestHeader('content-type', 'application/json');
  x.timeout = 20000;
  x.onload = () => res(x.responseText.slice(0, 300));
  x.onerror = () => res('xhr error');
  x.ontimeout = () => res('xhr timeout');
  x.send(JSON.stringify(body));
})
"""
JS_FETCH = """
async (body) => { const c = new AbortController(); setTimeout(() => c.abort(), 20000);
  try { const r = await fetch('/api/shop/pdp_desktop/get_product_reviews', {method:'POST', signal:c.signal,
    headers:{'content-type':'application/json'}, body: JSON.stringify(body)}); return (await r.text()).slice(0,300) }
  catch(e) { return 'fetch error ' + e } }
"""


async def main():
    out = {}
    async with async_playwright() as pw:
        browser, page = await reviews.open_shop_page(pw, f"https://shop.tiktok.com/us/pdp/x/{PID}")
        out["title"] = await page.title()
        out["cookies"] = [c["name"] for c in await page.context.cookies()]
        for name, fn in [("xhr", lambda: page.evaluate(JS_XHR, BODY)), ("fetch", lambda: page.evaluate(JS_FETCH, BODY)),
                         ("ctx_request", lambda: ctx_post(page))]:
            try:
                out[name] = str(await asyncio.wait_for(fn(), 40))[:300]
            except Exception as e:  # noqa: BLE001
                out[name] = "exc " + repr(e)[:200]
            logging.info("%s: %s", name, out[name])
        await browser.close()
    print(json.dumps(out, indent=1))
    conn = db.connect()
    rid = db.start_run(conn, "probe_reviews_browser")
    db.finish_run(conn, rid, True, out)


async def ctx_post(page):
    r = await page.context.request.post("https://shop.tiktok.com/api/shop/pdp_desktop/get_product_reviews", data=BODY,
                                        headers={"Origin": "https://shop.tiktok.com", "Referer": page.url}, timeout=20000)
    return (await r.text())[:300]

asyncio.run(main())
