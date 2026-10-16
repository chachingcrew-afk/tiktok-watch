"""One-off probe (no proxy): capture the product page's page_data request (body + where the creator
videos sit in the response), then try replaying it with a plain HTTP request.

Stores findings in tiktok_watch.runs (job = 'probe_pagedata'). Never stores credentials.
"""
from __future__ import annotations

import asyncio
import json
import re

import requests
from playwright.async_api import async_playwright

import db
from fetch_video import HEADERS


def find_paths(obj, want, path="", out=None, depth=0):
    out = [] if out is None else out
    if depth > 12 or len(out) > 30:
        return out
    if isinstance(obj, dict):
        for k, v in obj.items():
            p = f"{path}.{k}"
            if re.search(want, k):
                out.append((p, str(v)[:200]))
            find_paths(v, want, p, out, depth + 1)
    elif isinstance(obj, list):
        for i, v in enumerate(obj[:3]):
            find_paths(v, want, f"{path}[{i}]", out, depth + 1)
    return out


async def main() -> None:
    conn = db.connect()
    with conn.cursor() as cur:
        cur.execute("select url from tiktok_watch.shop_products where url like '%/pdp/%' order by last_sold desc nulls last limit 1")
        url = cur.fetchone()[0]
    out = {"url": url, "calls": []}
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(user_agent=HEADERS["User-Agent"], locale="en-US")
        page = await ctx.new_page()
        await page.route("**/*", lambda r, q: r.abort() if q.resource_type in ("image", "media", "font") else r.continue_())
        captured = []

        async def on_resp(resp):
            u = resp.url
            if "/api/shop/" in u and resp.request.method == "POST":
                try:
                    body = await resp.text()
                except Exception:
                    body = ""
                captured.append({"url": u, "post": resp.request.post_data, "headers": resp.request.headers, "resp": body})

        page.on("response", lambda r: asyncio.ensure_future(on_resp(r)))
        await page.goto(url, wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_timeout(5000)
        for _ in range(10):
            await page.mouse.wheel(0, 1200)
            await page.wait_for_timeout(700)
        await page.wait_for_timeout(3000)
        dom_lines = await page.evaluate("""() => { const el=[...document.querySelectorAll('*')].find(e=>e.childElementCount===0 && /^Videos for this product$/i.test((e.textContent||'').trim())); let s=el; while (s && s.innerText.split('\\n').length<6) s=s.parentElement; return s ? s.innerText.split('\\n').slice(0,12) : null; }""")
        out["dom_video_lines"] = dom_lines
        await b.close()
    for c in captured:
        entry = {"path": c["url"].split("?")[0], "query_keys": re.findall(r"[?&]([^=&]+)=", c["url"]),
                 "post": (c["post"] or "")[:3000], "resp_len": len(c["resp"]),
                 "header_keys": sorted(k for k in c["headers"] if not k.startswith(":"))}
        try:
            j = json.loads(c["resp"])
            entry["paths"] = find_paths(j, r"(?i)video|digg|like_count|play|author|nickname")[:30]
        except ValueError:
            entry["paths"] = None
        out["calls"].append(entry)
    # replay the page_data call with a plain request (same body, same query, no browser)
    pd = next((c for c in captured if "page_data" in c["url"]), None)
    if pd:
        h = {k: v for k, v in pd["headers"].items() if not k.startswith(":") and k.lower() not in ("cookie", "content-length")}
        try:
            r = requests.post(pd["url"], data=pd["post"], headers=h, timeout=30)
            out["replay"] = {"status": r.status_code, "len": len(r.text), "has_video_list": "video" in r.text, "start": r.text[:300]}
        except Exception as e:  # noqa: BLE001
            out["replay"] = {"error": str(e)[:200]}
    run_id = db.start_run(conn, "probe_pagedata")
    db.finish_run(conn, run_id, True, json.loads(json.dumps(out, default=str)))
    conn.close()


if __name__ == "__main__":
    asyncio.run(main())
