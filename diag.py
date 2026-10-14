"""Diagnose TikTok blocking: try several browser/proxy/token combinations and record which ones return videos.

Results go to the log and to tiktok_watch.runs (job = 'diagnose'). Never prints credentials.
"""
from __future__ import annotations

import asyncio
import logging
import os
import traceback

import requests

import db
from core import proxy_settings
from session import setup_logging, tiktok_session

log = logging.getLogger("tiktok-watch")

VARIANTS = [
    # name, browser, headless, ms_token, proxy
    ("chromium_headless_token_proxy", "chromium", True, True, True),
    ("chromium_headful_token_proxy", "chromium", False, True, True),
    ("chromium_headful_notoken_proxy", "chromium", False, False, True),
    ("webkit_headful_token_proxy", "webkit", False, True, True),
    ("webkit_headful_notoken_proxy", "webkit", False, False, True),
    ("chromium_headful_token_noproxy", "chromium", False, True, False),
]


def proxy_check() -> dict:
    _, req = proxy_settings(os.environ.get("PROXY_URL"))
    out = {"proxy_set": bool(req)}
    if not req:
        return out
    try:
        r = requests.get("https://ipinfo.io/json", proxies=req, timeout=20)
        j = r.json()
        out.update(proxy_ok=True, country=j.get("country"), org=j.get("org"), city=j.get("city"))
    except Exception as e:
        out.update(proxy_ok=False, proxy_error=type(e).__name__ + ": " + str(e)[:200].replace(os.environ.get("PROXY_URL", "~"), "***"))
    try:
        r = requests.get("https://www.tiktok.com/", proxies=req, timeout=25,
                         headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128 Safari/537.36"})
        out.update(tiktok_status=r.status_code, tiktok_bytes=len(r.content))
    except Exception as e:
        out.update(tiktok_error=type(e).__name__ + ": " + str(e)[:200].replace(os.environ.get("PROXY_URL", "~"), "***"))
    return out


async def try_variant(name, browser, headless, use_token, use_proxy) -> dict:
    res = {"ok": False}
    try:
        async with tiktok_session(headless=headless, browser=browser, use_ms_token=use_token, use_proxy=use_proxy) as (api, _):
            n = 0
            async for _v in api.hashtag(name="tiktokmademebuyit").videos(count=5):
                n += 1
            res["hashtag_videos"] = n
            if n == 0:
                n2 = 0
                async for _v in api.trending.videos(count=5):
                    n2 += 1
                res["trending_videos"] = n2
            res["ok"] = n > 0 or res.get("trending_videos", 0) > 0
    except Exception as e:
        res["error"] = (type(e).__name__ + ": " + str(e))[:300]
        log.debug(traceback.format_exc())
    log.info("VARIANT %-34s %s", name, res)
    return res


async def main() -> None:
    setup_logging()
    results = {"proxy": proxy_check()}
    log.info("PROXY %s", results["proxy"])
    only = os.environ.get("ONLY_VARIANTS")
    for v in VARIANTS:
        if only and v[0] not in only.split(","):
            continue
        results[v[0]] = await try_variant(*v)
    working = [k for k, r in results.items() if k != "proxy" and r.get("ok")]
    log.info("WORKING: %s", working or "none")
    try:
        conn = db.connect()
        run_id = db.start_run(conn, "diagnose")
        db.finish_run(conn, run_id, bool(working), results, None if working else "no variant returned videos")
        conn.close()
    except Exception as e:
        log.error("Could not store results: %s", e)


if __name__ == "__main__":
    asyncio.run(main())
