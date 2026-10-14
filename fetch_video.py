"""Fetch one TikTok video's current stats from its public page, without a browser.

The tracker only needs view/like/share counts, which TikTok embeds as JSON in the video page.
A plain HTTPS request through the proxy is faster, cheaper on bandwidth and far less fragile than
starting a headless browser (one slow page load used to abort the whole tracking run).
"""
from __future__ import annotations

import json
import random
import time

import requests

USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")
HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
UNIVERSAL = '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">'
SIGI = '<script id="SIGI_STATE" type="application/json">'


class VideoUnavailable(Exception):
    """TikTok answered, but the video is gone, private or the page had no data."""


def _script_json(html: str, marker: str) -> dict | None:
    start = html.find(marker)
    if start == -1:
        return None
    start += len(marker)
    end = html.find("</script>", start)
    if end == -1:
        return None
    return json.loads(html[start:end])


def parse_video_page(html: str, video_id: str) -> dict:
    """Return the video's item dict (same shape TikTokApi uses: id, createTime, stats, author, ...)."""
    data = _script_json(html, UNIVERSAL)
    if data is not None:
        detail = data.get("__DEFAULT_SCOPE__", {}).get("webapp.video-detail", {})
        if detail.get("statusCode", 0) != 0:
            raise VideoUnavailable(f"statusCode {detail.get('statusCode')}")
        item = detail.get("itemInfo", {}).get("itemStruct")
        if item:
            return item
    data = _script_json(html, SIGI)
    if data is not None:
        item = data.get("ItemModule", {}).get(video_id)
        if item:
            return item
    raise VideoUnavailable("no video data in page")


def fetch_video(url: str, video_id: str, proxies: dict | None, attempts: int = 3, timeout: int = 30) -> dict:
    """Fetch with retries. With a rotating proxy every attempt goes out through a new IP."""
    last: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            r = requests.get(url, headers=HEADERS, proxies=proxies, timeout=timeout)
            if r.status_code == 200:
                return parse_video_page(r.text, video_id)
            if r.status_code in (404, 410):
                raise VideoUnavailable(f"HTTP {r.status_code}")
            last = RuntimeError(f"HTTP {r.status_code}")
        except VideoUnavailable as e:
            # An empty/blocked page can look like a missing video; retry once more before giving up.
            last = e
        except (requests.RequestException, ValueError) as e:
            last = e
        if attempt < attempts:
            time.sleep(random.uniform(2, 5) * attempt)
    raise last or RuntimeError("fetch failed")
