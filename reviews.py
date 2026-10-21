"""TikTok Shop product reviews.

The review API (POST /api/shop/pdp_desktop/get_product_reviews) only answers requests that carry the
cookies the product page's own scripts set (msToken, s_v_web_id, ...); plain HTTP clients get code
100000. So a real browser opens the product page once and the requests are made from inside it.

What we keep per product: every 1-3 star review (up to a cap, newest first, that's where the
problems are), the newest 4 and 5 star ones, and the newest reviews with photos.
"""
from __future__ import annotations

import asyncio
import logging

log = logging.getLogger(__name__)

API = "/api/shop/pdp_desktop/get_product_reviews"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/124.0.0.0 Safari/537.36")

# (filter_type, filter_value, max reviews): filter_type 1 = star rating, 2 = with photos/videos
PLAN = [(1, 1, 250), (1, 2, 200), (1, 3, 200), (1, 4, 100), (1, 5, 150), (2, 0, 100)]
PAGE_SIZE = 50

JS_FETCH = """
async ([pid, ft, fv, page, size]) => {
  const r = await fetch('%s', {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({product_id: pid, page_start: page, page_size: size, sort_rule: 2,
                          review_filter: {filter_type: ft, filter_value: fv}, component_name: 'product_review'})});
  return await r.json();
}
""" % API


def parse_review(r: dict) -> dict | None:
    if not isinstance(r, dict) or not r.get("review_id"):
        return None
    imgs = [u for u in (r.get("review_images") or []) if isinstance(u, str)]
    try:
        ts = int(r.get("review_time") or 0) // 1000
    except (TypeError, ValueError):
        ts = 0
    return {
        "review_id": str(r["review_id"]),
        "rating": r.get("review_rating"),
        "time": ts or None,
        "verified": bool(r.get("is_verified_purchase")),
        "incentivized": bool(r.get("is_incentivized_review")),
        "text": (r.get("review_text") or "").strip()[:4000] or None,
        "sku": (r.get("sku_specification") or "").strip()[:300] or None,
        "country": r.get("review_country"),
        "reviewer": r.get("reviewer_name"),
        "images": imgs[:9],
    }


async def fetch_reviews(page, product_id: str, plan=PLAN) -> dict:
    """Run inside an open shop.tiktok.com page. Returns {summary, reviews, errors}."""
    seen: dict[str, dict] = {}
    summary, errors = None, []
    for ft, fv, cap in plan:
        got = 0
        pg = 1
        while got < cap:
            data = None
            for attempt in range(3):
                try:
                    j = await page.evaluate(JS_FETCH, [str(product_id), ft, fv, pg, PAGE_SIZE])
                except Exception as e:  # noqa: BLE001
                    j = {"code": -1, "message": str(e)[:120]}
                if j.get("code") == 0:
                    data = j.get("data") or {}
                    break
                await asyncio.sleep(1.5 * (attempt + 1))
            if data is None:
                errors.append(f"{ft}/{fv} p{pg}: code {j.get('code')}")
                break
            if summary is None and data.get("review_ratings"):
                summary = data["review_ratings"]
            items = data.get("product_reviews") or []
            for r in items:
                p = parse_review(r)
                if p:
                    seen.setdefault(p["review_id"], p)
            got += len(items)
            if not items or not data.get("has_more"):
                break
            pg += 1
    return {"summary": summary, "reviews": list(seen.values()), "errors": errors}


async def open_shop_page(pw, url: str):
    browser = await pw.chromium.launch(headless=True, args=["--disable-blink-features=AutomationControlled"])
    context = await browser.new_context(user_agent=UA, locale="en-US", viewport={"width": 1366, "height": 900})
    page = await context.new_page()
    await page.goto(url, wait_until="domcontentloaded", timeout=60000)
    await page.wait_for_timeout(4000)
    return browser, page
