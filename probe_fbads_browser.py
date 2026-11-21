"""Probe: can a plain headless browser read the public Meta Ad Library (facebook.com/ads/library)?

Opens one keyword search (US, active ads), scrolls a little at a calm pace, and records what the page
delivers: ads embedded in the HTML and in the GraphQL responses it loads while scrolling. Tries without
the proxy first, then with it. No login, no captcha solving: if the page asks for either, that is recorded.
"""
import asyncio
import json
import os
import re
import time
from urllib.parse import quote

from playwright.async_api import async_playwright

import db
from core import proxy_settings

Q = os.environ.get("FB_Q", "posture corrector")
URL = ("https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&is_targeted_country=false"
       f"&media_type=all&q={quote(Q)}&search_type=keyword_unordered")


def find_ads(obj, out):
    """Collect dicts that look like an ad (they carry ad_archive_id)."""
    if isinstance(obj, dict):
        if "ad_archive_id" in obj and ("snapshot" in obj or "page_name" in obj):
            out.append(obj)
        for v in obj.values():
            find_ads(v, out)
    elif isinstance(obj, list):
        for v in obj:
            find_ads(v, out)


def json_blobs(text):
    for m in re.finditer(r'<script type="application/json"[^>]*>(.*?)</script>', text, re.S):
        try:
            yield json.loads(m.group(1))
        except Exception:
            pass


async def attempt(pw, proxy):
    res = {"proxy": bool(proxy), "graphql": 0, "ads_html": 0, "ads_gql": 0}
    browser = await pw.chromium.launch(headless=True, proxy=proxy)
    try:
        ctx = await browser.new_context(locale="en-US", viewport={"width": 1280, "height": 900})
        page = await ctx.new_page()
        gql_ads = []

        async def on_resp(r):
            if "/api/graphql" in r.url:
                res["graphql"] += 1
                try:
                    t = await asyncio.wait_for(r.text(), 15)
                    for line in t.splitlines():
                        try:
                            find_ads(json.loads(line), gql_ads)
                        except Exception:
                            pass
                except Exception:
                    pass
        page.on("response", on_resp)
        t0 = time.time()
        r = await page.goto(URL, wait_until="domcontentloaded", timeout=60000)
        res["status"] = r.status if r else None
        await page.wait_for_timeout(6000)
        html = await page.content()
        res["final_url"] = page.url[:200]
        res["login_wall"] = "login" in page.url or "checkpoint" in page.url
        res["html_len"] = len(html)
        html_ads = []
        for b in json_blobs(html):
            find_ads(b, html_ads)
        res["ads_html"] = len(html_ads)
        m = re.search(r'~?\s*([\d,]+)\s+results', await page.inner_text("body"))
        res["results_text"] = m.group(0) if m else None
        for _ in range(3):
            await page.mouse.wheel(0, 4000)
            await page.wait_for_timeout(4000)
        res["ads_gql"] = len(gql_ads)
        res["secs"] = round(time.time() - t0, 1)
        ads = html_ads + gql_ads
        res["unique_ads"] = len({a.get("ad_archive_id") for a in ads})
        if ads:
            a = ads[0]
            res["ad_keys"] = sorted(a.keys())
            res["snapshot_keys"] = sorted((a.get("snapshot") or {}).keys())
            res["sample"] = json.dumps(a)[:5000]
        else:
            body = await page.inner_text("body")
            res["body_start"] = body[:600]
    except Exception as e:
        res["error"] = f"{type(e).__name__}: {str(e)[:300]}"
    finally:
        await browser.close()
    return res


async def main():
    out = {"q": Q}
    async with async_playwright() as pw:
        async def guarded(proxy):
            try:
                return await asyncio.wait_for(attempt(pw, proxy), 150)
            except asyncio.TimeoutError:
                return {"proxy": bool(proxy), "error": "timeout after 150 s"}
        out["direct"] = await guarded(None)
        print("direct", json.dumps(out["direct"])[:1500], flush=True)
        pw_proxy, _ = proxy_settings(os.environ.get("PROXY_URL"))
        if pw_proxy:
            await asyncio.sleep(5)
            out["proxy"] = await guarded(pw_proxy)
    conn = db.connect()
    rid = db.start_run(conn, "probe_fbads")
    db.finish_run(conn, rid, True, out)
    print(json.dumps(out, indent=1)[:4000])


if __name__ == "__main__":
    asyncio.run(main())
