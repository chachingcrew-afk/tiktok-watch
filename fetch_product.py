"""Fetch a TikTok Shop product page (shop.tiktok.com/us/pdp/...) and read price and units sold.

The page embeds its data as (escaped) JSON. Rather than depend on the exact nesting, which TikTok
changes often, the text is un-escaped and the few fields we need are read with targeted patterns.
"""
from __future__ import annotations

import random
import re
import time

import requests

import netstats

DIRECT_FIRST = __import__('os').environ.get('DIRECT_FIRST', '1') == '1'

from fetch_video import HEADERS


class ProductUnavailable(Exception):
    pass


def _unescape(html: str) -> str:
    # The data sits inside JSON strings, so quotes appear as \" (or \\\" when nested twice).
    return html.replace('\\\\\\"', '"').replace('\\"', '"')


def _num(s: str | None) -> float | None:
    if s is None:
        return None
    try:
        return float(s.replace(",", ""))
    except ValueError:
        return None


def parse_product_page(html: str, product_id: str) -> dict:
    text = _unescape(html)
    out: dict = {}

    m = re.search(r'"price":\s*\{[^{}]*?"min_sku_price":\s*"([\d.,]+)"[^{}]*\}', text)
    if m:
        block = m.group(0)
        out["price_min"] = _num(m.group(1))
        mx = re.search(r'"max_sku_price":\s*"([\d.,]+)"', block)
        out["price_max"] = _num(mx.group(1)) if mx else out["price_min"]
        orig = re.search(r'"min_sku_original_price":\s*"([\d.,]+)"', block)
        out["price_original"] = _num(orig.group(1)) if orig else None
        disp = re.search(r'"real_price":\s*"([^"]+)"', block)
        out["price_display"] = disp.group(1) if disp else None

    # units sold sits in product_info next to this product's id
    m = re.search(r'"sold_count":\s*"?(\d+)"?,\s*"product_id":\s*"' + re.escape(str(product_id)) + '"', text)
    if not m:
        start = text.find('"product_info":')
        if start != -1:
            m = re.search(r'"sold_count":\s*"?(\d+)"?', text[start:start + 3000])
    if m:
        out["sold"] = int(m.group(1))

    if "price_min" not in out and "sold" not in out:
        raise ProductUnavailable("no product data in page")
    return out


def fetch_product(url: str, product_id: str, proxies: dict | None, attempts: int = 3, timeout: int = 30) -> dict:
    last: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            # first try GitHub's own IP (free); the paid proxy only if that fails
            via = None if (attempt == 1 and proxies and DIRECT_FIRST) else proxies
            r = netstats.get(url, headers=HEADERS, proxies=via, timeout=timeout)
            if r.status_code == 200:
                return parse_product_page(r.text, product_id)
            if r.status_code in (404, 410):
                raise ProductUnavailable(f"HTTP {r.status_code}")
            last = RuntimeError(f"HTTP {r.status_code}")
        except ProductUnavailable as e:
            last = e
        except requests.RequestException as e:
            last = e
        if attempt < attempts:
            time.sleep(random.uniform(2, 5) * attempt)
    raise last or RuntimeError("fetch failed")
