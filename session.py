"""Shared TikTokApi session setup."""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager

from TikTokApi import TikTokApi

from core import proxy_settings
import tiktok_patch

log = logging.getLogger("tiktok-watch")

# Skipping images, video and fonts saves most of the proxy bandwidth; TikTok's API calls still work.
SAVE_BANDWIDTH = ["image", "media", "font"]
START_URL = "https://www.tiktok.com"
NAV_TIMEOUT_MS = 90_000


async def _patient_page(context):
    """A stealth page with a longer timeout, left blank on purpose.

    TikTokApi's own first navigation uses Playwright's fixed 30 s limit, which a slow proxy exit
    IP can miss. Returning a blank page makes TikTokApi do the navigation itself (so it still
    captures the request headers it needs), but with this page's 90 s limit.
    """
    from TikTokApi.stealth import stealth_async
    page = await context.new_page()
    await stealth_async(page)
    page.set_default_navigation_timeout(NAV_TIMEOUT_MS)
    page.set_default_timeout(NAV_TIMEOUT_MS)
    # With a page_factory TikTokApi only blocks images after its first navigation; block them
    # from the start so the first load stays light on proxy bandwidth.
    await page.route("**/*", lambda route, request: (
        route.abort() if request.resource_type in SAVE_BANDWIDTH else route.continue_()))
    return page


def setup_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def env_flag(name: str, default: str) -> bool:
    return os.environ.get(name, default).strip().lower() in ("1", "true", "yes")


@asynccontextmanager
async def tiktok_session(headless: bool | None = None, browser: str | None = None,
                         use_ms_token: bool | None = None, use_proxy: bool = True):
    """Open one TikTok browser session. Defaults come from env: HEADLESS, TIKTOK_BROWSER, USE_MS_TOKEN."""
    headless = env_flag("HEADLESS", "1") if headless is None else headless
    browser = browser or os.environ.get("TIKTOK_BROWSER", "chromium")
    use_ms_token = env_flag("USE_MS_TOKEN", "1") if use_ms_token is None else use_ms_token

    ms_token = os.environ.get("MS_TOKEN") if use_ms_token else None
    pw_proxy, req_proxy = proxy_settings(os.environ.get("PROXY_URL")) if use_proxy else (None, None)
    if use_proxy and not pw_proxy:
        log.warning("No PROXY_URL set. From a server TikTok will very likely block requests.")
    patch = env_flag("SIGNING_PATCH", "1")
    context_options = {}
    if patch:
        tiktok_patch.apply()
        ua = await tiktok_patch.clean_user_agent(browser, headless)
        if ua:
            context_options["user_agent"] = ua
    log.info("Session: browser=%s headless=%s ms_token=%s proxy=%s", browser, headless, bool(ms_token), bool(pw_proxy))
    # Starting the session loads tiktok.com through the proxy; a rotating proxy hands every
    # connection a different home IP and a run of bad ones can stall the page. Retry with a fresh
    # browser, and as a last resort start once without the proxy (GitHub's own US IP also works).
    plan = [pw_proxy] * 3 + ([None] if pw_proxy else [])
    if not pw_proxy:
        plan = [None] * 3
    attempts = len(plan)
    for attempt, proxy in enumerate(plan, start=1):
        started = False
        if attempt > 1 and proxy is None and pw_proxy:
            log.warning("Proxy kept failing; trying once without the proxy.")
            req_proxy = None
        try:
            async with TikTokApi() as api:
                await api.create_sessions(
                    ms_tokens=[ms_token] if ms_token else None,
                    num_sessions=1,
                    sleep_after=4,
                    headless=headless,
                    proxies=[proxy] if proxy else None,
                    browser=browser,
                    suppress_resource_load_types=SAVE_BANDWIDTH,
                    timeout=NAV_TIMEOUT_MS,
                    context_options=context_options,
                    page_factory=_patient_page,
                )
                # TikTokApi can log a failed start and still return a session without request
                # headers; every call would then fail. Treat that as a failed start and retry.
                if not api.sessions or not all(getattr(x, "headers", None) for x in api.sessions):
                    raise RuntimeError("session started without request headers")
                started = True
                yield api, req_proxy
            return
        except Exception as e:
            if started or attempt == attempts:
                raise
            log.warning("Session start failed (attempt %d/%d): %s. Retrying.", attempt, attempts, e)
            await asyncio.sleep(10 * attempt)
