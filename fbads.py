"""Meta (Facebook / Instagram) Ad Library scraper.

Reads the public Ad Library pages (facebook.com/ads/library, US, active ads, most impressions first)
in a headless browser through the proxy, without logging in, and keeps the ads in tiktok_watch.fb_ads:

  * niche keywords (settings 'fb_keywords'): long running ads = products that sell, new product ideas
  * products of the Termékek list, best sellers first: how many ads run for it, who runs them, since when
  * watched pages (tiktok_watch.fb_pages): every active ad of a competitor
  * creatives: ad text, headline, landing page, image / video links (Facebook's links expire after a few days)

A calm pace (PAUSE between searches). When Facebook asks for a login or a check, the run stops and says so;
it does not try to get around it.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import re
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from urllib.parse import quote, urlparse

from playwright.async_api import async_playwright

import db
import media_store
from core import proxy_settings
from session import setup_logging

log = logging.getLogger("fbads")

BASE = "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&is_targeted_country=false&media_type=all"
PAUSE = (6.0, 12.0)                     # seconds between two searches
SCROLLS = int(os.environ.get("FB_SCROLLS", "6"))  # extra pages of ads per search (about 30 ads each, if Facebook loads them)
PRODUCTS_PER_RUN = int(os.environ.get("FB_PRODUCTS", "40"))
PRODUCT_REFRESH_DAYS = int(os.environ.get("FB_PRODUCT_REFRESH_DAYS", "7"))
NICHE_REFRESH_HOURS = int(os.environ.get("FB_NICHE_REFRESH_HOURS", "20"))
PAGE_REFRESH_HOURS = int(os.environ.get("FB_PAGE_REFRESH_HOURS", "20"))
TIME_BUDGET_S = int(os.environ.get("FB_TIME_BUDGET_S", "3000"))
VIDEO_MIN_DAYS = int(os.environ.get("FB_VIDEO_MIN_DAYS", "14"))   # videos are big: keep them for ads that run at least this long
VIDEO_MAX_MB = int(os.environ.get("FB_VIDEO_MAX_MB", "30"))
STATS: Counter = Counter()

STOP = set("""a an and the for with of to in on by from your you our my is are be at as or this that new hot best top
women womens woman men mens man girls boys kids unisex plus size sizes pack pcs pc piece pieces set sets inch inches
oz ml lb lbs cm mm xl xxl xs s m l black white pink blue red green gray grey beige brown purple navy color colors
adjustable portable upgraded upgrade premium professional original 2024 2025 2026 gift gifts""".split())


def product_query(title: str) -> str:
    """A short search phrase from a TikTok Shop title: the first meaningful words."""
    t = re.split(r"[,|(\[\-–:]", title or "")[0]
    words = [w for w in re.findall(r"[a-z]+", t.lower()) if w not in STOP and len(w) > 2]
    if len(words) < 2:
        words = [w for w in re.findall(r"[a-z]+", (title or "").lower()) if w not in STOP and len(w) > 2]
    return " ".join(words[:4])


def find_ads(obj, out: list) -> None:
    if isinstance(obj, dict):
        if "ad_archive_id" in obj and "snapshot" in obj:
            out.append(obj)
            return
        for v in obj.values():
            find_ads(v, out)
    elif isinstance(obj, list):
        for v in obj:
            find_ads(v, out)


def ts(v):
    try:
        return datetime.fromtimestamp(int(v), timezone.utc) if v else None
    except (TypeError, ValueError):
        return None


def flat(a: dict) -> dict:
    s = a.get("snapshot") or {}
    cards = s.get("cards") or []
    c0 = cards[0] if cards else {}
    imgs = s.get("images") or []
    vids = s.get("videos") or []
    img = (imgs[0].get("original_image_url") or imgs[0].get("resized_image_url")) if imgs else (c0.get("original_image_url") or c0.get("resized_image_url"))
    vid = vids[0] if vids else ({"video_hd_url": c0.get("video_hd_url"), "video_sd_url": c0.get("video_sd_url"), "video_preview_image_url": c0.get("video_preview_image_url")} if c0 else {})
    link = s.get("link_url") or c0.get("link_url")
    body = ((s.get("body") or {}).get("text") if isinstance(s.get("body"), dict) else s.get("body")) or c0.get("body")
    if body and "{{product." in body:
        body = c0.get("body") or body
    title = s.get("title") or c0.get("title")
    if title and "{{product." in title:   # dynamic catalogue ad: the real name is on the first card
        title = c0.get("title") or None
    dom = (urlparse(link).hostname or "").removeprefix("www.") if link else None
    return {
        "id": str(a.get("ad_archive_id")), "page_id": str(a.get("page_id") or s.get("page_id") or ""),
        "page_name": a.get("page_name") or s.get("page_name"), "page_likes": s.get("page_like_count"),
        "page_url": s.get("page_profile_uri"), "page_picture": s.get("page_profile_picture_url"),
        "start": ts(a.get("start_date")), "end": ts(a.get("end_date")), "active": a.get("is_active"),
        "collation_count": a.get("collation_count"), "collation_id": str(a.get("collation_id") or "") or None,
        "link": link, "domain": dom, "title": title, "body": body, "caption": s.get("caption"),
        "cta": s.get("cta_text"), "format": s.get("display_format"),
        "image": img, "video": (vid or {}).get("video_hd_url") or (vid or {}).get("video_sd_url"),
        "preview": (vid or {}).get("video_preview_image_url"),
        "platforms": a.get("publisher_platform") or [],
    }


def save_ads(conn, ads: list[dict], niche: str | None, query: str | None) -> None:
    with conn.cursor() as cur:
        for x in ads:
            cur.execute("""
                insert into tiktok_watch.fb_ads (ad_archive_id, page_id, page_name, page_likes, page_url, page_picture, start_date, end_date,
                  is_active, collation_count, collation_id, link_url, domain, title, body, caption, cta, display_format, image_url, video_url,
                  video_preview, platforms, niche, queries)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, case when %s::text is null then '{}'::text[] else array[%s::text] end)
                on conflict (ad_archive_id) do update set
                  page_name = excluded.page_name, page_likes = excluded.page_likes, page_url = excluded.page_url, page_picture = excluded.page_picture,
                  end_date = excluded.end_date, is_active = excluded.is_active, collation_count = excluded.collation_count,
                  link_url = coalesce(excluded.link_url, tiktok_watch.fb_ads.link_url), domain = coalesce(excluded.domain, tiktok_watch.fb_ads.domain),
                  title = coalesce(excluded.title, tiktok_watch.fb_ads.title), body = coalesce(excluded.body, tiktok_watch.fb_ads.body),
                  image_url = coalesce(excluded.image_url, tiktok_watch.fb_ads.image_url), video_url = coalesce(excluded.video_url, tiktok_watch.fb_ads.video_url),
                  video_preview = coalesce(excluded.video_preview, tiktok_watch.fb_ads.video_preview),
                  niche = coalesce(tiktok_watch.fb_ads.niche, excluded.niche),
                  queries = (select array(select distinct q from unnest(tiktok_watch.fb_ads.queries || excluded.queries) q limit 20)),
                  last_seen = now()""",
                (x["id"], x["page_id"] or None, x["page_name"], x["page_likes"], x["page_url"], x["page_picture"], x["start"], x["end"],
                 x["active"], x["collation_count"], x["collation_id"], x["link"], x["domain"], x["title"], x["body"], x["caption"], x["cta"],
                 x["format"], x["image"], x["video"], x["preview"], x["platforms"], niche, query, query))


def save_search(conn, kind, key, query, niche, est, ads, error=None) -> None:
    with conn.cursor() as cur:
        cur.execute("""insert into tiktok_watch.fb_searches (kind, key, query, niche, results_est, ads, ad_ids, checked_at, error)
                       values (%s,%s,%s,%s,%s,%s,%s, now(), %s)
                       on conflict (kind, key) do update set query = excluded.query, niche = excluded.niche, results_est = excluded.results_est,
                         ads = excluded.ads, ad_ids = excluded.ad_ids, checked_at = now(), error = excluded.error""",
                    (kind, key, query, niche, est, len(ads), [x["id"] for x in ads], error))


def store_media(conn, ads: list[dict], proxies: dict | None, watched: bool = False) -> None:
    """Copy the creatives of new ads to R2 while Facebook's links still work (they expire in a few days)."""
    if not media_store.enabled() or not ads:
        return
    with conn.cursor() as cur:
        cur.execute("select ad_archive_id, image_key, video_key, poster_key from tiktok_watch.fb_ads where ad_archive_id = any(%s)", ([x["id"] for x in ads],))
        have = {r[0]: r[1:] for r in cur.fetchall()}
    now = datetime.now(timezone.utc)

    def one(x):
        img_k, vid_k, pos_k = have.get(x["id"], (None, None, None))
        upd = {}
        try:
            if x["image"] and not img_k:
                raw = media_store.download(x["image"], 15 * 2**20, None)
                w = media_store.webp(raw) if raw else None
                if w:
                    upd["image_key"] = media_store.put(f"fb/{x['id']}.webp", w, "image/webp")
            if x["preview"] and not pos_k:
                raw = media_store.download(x["preview"], 15 * 2**20, None)
                w = media_store.webp(raw) if raw else None
                if w:
                    upd["poster_key"] = media_store.put(f"fb/{x['id']}-poster.webp", w, "image/webp")
            days = (now - x["start"]).days if x["start"] else 0
            if x["video"] and not vid_k and (watched or days >= VIDEO_MIN_DAYS or (x["collation_count"] or 0) >= 3):
                raw = media_store.download(x["video"], VIDEO_MAX_MB * 2**20, None, timeout=60)
                if raw:
                    upd["video_key"] = media_store.put(f"fb/{x['id']}.mp4", raw, "video/mp4")
                    STATS["media_mb"] += round(len(raw) / 2**20, 1)
                else:
                    STATS["videos_skipped"] += 1
        except Exception as e:
            STATS["media_errors"] += 1
            log.warning("media %s: %s", x["id"], e)
        return x["id"], upd

    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(6) as ex:
        for ad_id, upd in ex.map(one, ads):
            if upd:
                STATS["media_saved"] += len(upd)
                sets = ", ".join(f"{k} = %s" for k in upd)
                with conn.cursor() as cur:
                    cur.execute(f"update tiktok_watch.fb_ads set {sets} where ad_archive_id = %s", (*upd.values(), ad_id))
                conn.commit()


class Blocked(Exception):
    pass


async def search(page, url: str) -> tuple[list[dict], int | None]:
    """Open one Ad Library search, scroll a little, return the ads (flattened) and Facebook's result estimate."""
    gql: list = []

    async def on_resp(r):
        if "/api/graphql" in r.url:
            try:
                t = await asyncio.wait_for(r.text(), 15)
                for line in t.splitlines():
                    line = line.strip().removeprefix("for (;;);")   # Facebook prefixes its JSON with this guard
                    if not line.startswith("{"):
                        continue
                    try:
                        find_ads(json.loads(line), gql)
                    except ValueError:
                        pass
            except Exception:
                pass
    page.on("response", on_resp)
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_timeout(5000)
        if "login" in page.url or "checkpoint" in page.url:
            raise Blocked(page.url[:120])
        html = await page.content()
        ads: list = []
        for m in re.finditer(r'<script type="application/json"[^>]*>(.*?)</script>', html, re.S):
            try:
                find_ads(json.loads(m.group(1)), ads)
            except ValueError:
                pass
        body = await page.inner_text("body")
        m = re.search(r"~?\s*([\d,]+)\s+results?", body)
        est = int(m.group(1).replace(",", "")) if m else (0 if re.search(r"No ads match|0 results", body) else None)
        misses = 0
        for _ in range(SCROLLS if est is None or est > len(ads) else 0):
            n = len(gql)
            for _step in range(4):   # scroll in steps, like a person, so the next page of ads loads
                await page.mouse.wheel(0, 2500)
                await page.wait_for_timeout(700)
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await page.wait_for_timeout(3500)
            if len(gql) == n:
                misses += 1
                if misses >= 2:
                    break
            else:
                misses = 0
        STATS["gql_ads"] += len(gql)
        seen, out = set(), []
        for a in ads + gql:
            k = str(a.get("ad_archive_id"))
            if k not in seen:
                seen.add(k)
                out.append(flat(a))
        STATS["ads_seen"] += len(out)
        return out, est
    finally:
        page.remove_listener("response", on_resp)


def niches_due(conn) -> list[tuple[str, str]]:
    with conn.cursor() as cur:
        cur.execute("select value from tiktok_watch.settings where key = 'fb_keywords'")
        row = cur.fetchone()
        kw = (row and row[0]) or {}
        cur.execute("select key, checked_at from tiktok_watch.fb_searches where kind = 'niche'")
        last = dict(cur.fetchall())
    now = datetime.now(timezone.utc)
    out = []
    for niche, words in kw.items():
        for w in words or []:
            w = str(w).strip().lower()[:80]
            if w and (w not in last or (now - last[w]).total_seconds() > NICHE_REFRESH_HOURS * 3600):
                out.append((niche, w))
    random.shuffle(out)
    return out


def pages_due(conn) -> list[str]:
    with conn.cursor() as cur:
        cur.execute("""select p.page_id from tiktok_watch.fb_pages p left join tiktok_watch.fb_searches s on s.kind = 'page' and s.key = p.page_id
                       where s.checked_at is null or s.checked_at < now() - make_interval(hours => %s) order by s.checked_at nulls first""",
                    (PAGE_REFRESH_HOURS,))
        return [r[0] for r in cur.fetchall()]


def products_due(conn) -> list[tuple[str, str, str]]:
    with conn.cursor() as cur:
        cur.execute("""select l.product_id, p.title, p.niche from tiktok_watch.listed_ids() l
                       join tiktok_watch.shop_products p using (product_id)
                       left join tiktok_watch.fb_searches s on s.kind = 'product' and s.key = l.product_id
                       where s.checked_at is null or s.checked_at < now() - make_interval(days => %s)
                       order by (s.checked_at is not null), l.ord limit %s""", (PRODUCT_REFRESH_DAYS, PRODUCTS_PER_RUN))
        return cur.fetchall()


async def run(conn) -> None:
    pw_proxy, req_proxies = proxy_settings(os.environ.get("PROXY_URL"))
    start = time.monotonic()
    test = os.environ.get("FB_TEST_QUERY", "").strip()
    if test:   # one search, to see how many ads a search brings (manual runs)
        jobs = [("niche", test.lower(), test.lower(), None)]
    else:
        jobs = [("page", pid, None, None) for pid in pages_due(conn)]
        jobs += [("niche", w, w, n) for n, w in niches_due(conn)]
        jobs += [("product", pid, product_query(t), n) for pid, t, n in products_due(conn)]
    STATS["due"] = len(jobs)
    async with async_playwright() as pw:
        async def open_browser(proxy):
            b = await pw.chromium.launch(headless=True, proxy=proxy)
            c = await b.new_context(locale="en-US", viewport={"width": 1280, "height": 900})
            return b, await c.new_page()
        browser, page = await open_browser(pw_proxy)
        using_proxy = bool(pw_proxy)
        empty_in_row = 0
        try:
            for kind, key, query, niche in jobs:
                if time.monotonic() - start > TIME_BUDGET_S:
                    STATS["out_of_time"] = 1
                    break
                if kind == "product" and len(query.split()) < 2:
                    save_search(conn, kind, key, query, niche, None, [], "túl rövid keresőkifejezés")
                    conn.commit()
                    continue
                url = BASE + (f"&search_type=page&view_all_page_id={key}" if kind == "page" else f"&q={quote(query)}&search_type=keyword_unordered")
                await asyncio.sleep(random.uniform(*PAUSE))
                try:
                    ads, est = await search(page, url)
                except Blocked as e:
                    STATS["blocked"] = 1
                    log.warning("Facebook asked for a login or a check (%s): stopping this run", e)
                    break
                except Exception as e:
                    if using_proxy and re.search(r"ERR_(TUNNEL|PROXY)|ERR_TIMED_OUT|Timeout", str(e)):
                        # the proxy is down or too slow: carry on without it, and retry this search
                        STATS["proxy_dropped"] = 1
                        await browser.close()
                        browser, page = await open_browser(None)
                        using_proxy = False
                        try:
                            ads, est = await search(page, url)
                        except Exception as e2:
                            e = e2
                        else:
                            e = None
                    if e is not None:
                        STATS["errors"] += 1
                        save_search(conn, kind, key, query, niche, None, [], f"{type(e).__name__}: {str(e)[:200]}")
                        conn.commit()
                        continue
                # page and niche searches keep every ad; a product search keeps the ads, labelled with the product's niche
                save_ads(conn, ads, niche if kind != "page" else None, query)
                save_search(conn, kind, key, query, niche, est, ads)
                conn.commit()
                await asyncio.to_thread(store_media, conn, ads, req_proxies, kind == "page")
                STATS[kind + "_searches"] += 1
                empty_in_row = empty_in_row + 1 if not ads and est is None else 0
                if empty_in_row >= 4:   # pages keep coming back without ads: Facebook is probably limiting us
                    STATS["stopped_empty"] = 1
                    break
        finally:
            await browser.close()


def main() -> None:
    setup_logging()
    conn = db.connect()
    rid = db.start_run(conn, "fbads")
    try:
        asyncio.run(run(conn))
        db.finish_run(conn, rid, not STATS.get("blocked"), dict(STATS), "Facebook bejelentkezést kért" if STATS.get("blocked") else None)
    except Exception as e:
        conn.rollback()
        db.finish_run(conn, rid, False, dict(STATS), f"{type(e).__name__}: {str(e)[:300]}")
        raise


if __name__ == "__main__":
    main()
