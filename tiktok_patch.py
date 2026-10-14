"""Workaround for TikTok's newer request signing (X-Gnarly), applied on top of the official TikTokApi.

TikTok's web client now signs its own API requests (msToken, X-Bogus, X-Gnarly, X-Dynosaur) as
they leave the page. TikTokApi fetches from inside that page but also attaches its own msToken and
X-Bogus, and the duplicate signature makes TikTok answer with an empty body. Same idea as the
community fix proposed upstream (davidteather/TikTok-Api PR #1310), written here instead of
installing a third-party fork:

1. sign_url no longer adds X-Bogus and removes the params TikTok signs natively; msToken still
   travels in the browser's cookie jar.
2. The browser's user agent is reported without the "HeadlessChrome" marker TikTok flags.
"""
from __future__ import annotations

import logging
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit, quote

from TikTokApi import TikTokApi

log = logging.getLogger("tiktok-watch")

NATIVELY_SIGNED_PARAMS = frozenset({"mstoken", "x-bogus", "x-dynosaur", "x-gnarly"})


def strip_signed_params(url: str) -> str:
    parts = urlsplit(url)
    kept = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
            if k.lower() not in NATIVELY_SIGNED_PARAMS]
    return urlunsplit(parts._replace(query=urlencode(kept, safe="=", quote_via=quote)))


async def _unsigned_url(self, url: str, **kwargs) -> str:
    return strip_signed_params(url)


_applied = False


def apply() -> None:
    """Patch TikTokApi once per process."""
    global _applied
    if _applied:
        return
    TikTokApi.sign_url = _unsigned_url
    _applied = True
    log.info("Applied TikTok signing workaround (no manual X-Bogus/msToken).")


async def clean_user_agent(browser: str, headless: bool) -> str | None:
    """Launch the same browser briefly and return its user agent without the headless marker."""
    from playwright.async_api import async_playwright
    try:
        async with async_playwright() as p:
            b = await getattr(p, browser).launch(headless=headless)
            try:
                page = await (await b.new_context()).new_page()
                ua = await page.evaluate("() => navigator.userAgent")
            finally:
                await b.close()
        return ua.replace("HeadlessChrome", "Chrome").replace("Headless", "")
    except Exception as e:  # never block a run on this
        log.warning("Could not read browser user agent: %s", e)
        return None
