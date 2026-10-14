"""Shared TikTokApi session setup."""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from TikTokApi import TikTokApi

from core import proxy_settings

log = logging.getLogger("tiktok-watch")


def setup_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


@asynccontextmanager
async def tiktok_session():
    ms_token = os.environ.get("MS_TOKEN") or None
    pw_proxy, req_proxy = proxy_settings(os.environ.get("PROXY_URL"))
    if not pw_proxy:
        log.warning("No PROXY_URL set. From a server TikTok will very likely block requests.")
    async with TikTokApi() as api:
        await api.create_sessions(
            ms_tokens=[ms_token] if ms_token else None,
            num_sessions=1,
            sleep_after=3,
            headless=True,
            proxies=[pw_proxy] if pw_proxy else None,
            browser=os.environ.get("TIKTOK_BROWSER", "chromium"),
        )
        yield api, req_proxy
