"""Shared TikTokApi session setup."""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from TikTokApi import TikTokApi

from core import proxy_settings

log = logging.getLogger("tiktok-watch")

# Skipping images, video and fonts saves most of the proxy bandwidth; TikTok's API calls still work.
SAVE_BANDWIDTH = ["image", "media", "font"]


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
    log.info("Session: browser=%s headless=%s ms_token=%s proxy=%s", browser, headless, bool(ms_token), bool(pw_proxy))
    async with TikTokApi() as api:
        await api.create_sessions(
            ms_tokens=[ms_token] if ms_token else None,
            num_sessions=1,
            sleep_after=4,
            headless=headless,
            proxies=[pw_proxy] if pw_proxy else None,
            browser=browser,
            suppress_resource_load_types=SAVE_BANDWIDTH,
            timeout=60000,
        )
        yield api, req_proxy
