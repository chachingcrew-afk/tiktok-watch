import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core import Config, parse_video, passes_collect_filter, proxy_settings, tracking_decision  # noqa: E402

NOW = datetime(2026, 10, 13, 12, 0, tzinfo=timezone.utc)


def raw(hours_old=20, views=100_000, desc="This gadget is a game changer #tiktokmademebuyit", anchors=None):
    d = {
        "id": "7550000000000000001",
        "createTime": str(int((NOW - timedelta(hours=hours_old)).timestamp())),
        "author": {"uniqueId": "seller"},
        "desc": desc,
        "stats": {"playCount": views, "diggCount": 5000, "commentCount": 300, "shareCount": 900, "collectCount": 1200},
        "challenges": [{"title": "tiktokmademebuyit"}],
    }
    if anchors is not None:
        d["anchors"] = anchors
    return d


def test_parse_basic():
    v = parse_video(raw())
    assert v.url == "https://www.tiktok.com/@seller/video/7550000000000000001"
    assert v.views == 100_000 and v.shares == 900 and v.saves == 1200
    assert v.has_product


def test_parse_statsv2_strings():
    d = raw()
    d["statsV2"] = {"playCount": "250000", "diggCount": "1", "commentCount": "2", "shareCount": "3", "collectCount": "4"}
    assert parse_video(d).views == 250_000


def _shop_anchor(pid="1732570618364072053", title="20Pcs Christmas Gift Set"):
    import json as _j
    inner = {"product_id": int(pid), "title": title, "price": 0, "currency": "USD", "seller_id": 7494633470607590000,
             "seo_url": f"https://shop.tiktok.com/us/pdp/gift-set/{pid}?source=anchor",
             "cover_url": "https://img.example/cover.jpeg",
             "categories": [{"category_name": "Home Supplies"}, {"category_name": "Party Bags & Party Favors"}]}
    return {"type": 35, "extra": _j.dumps([{"type": 33, "keyword": title[:30], "id": pid, "extra": _j.dumps(inner)}])}


def test_anchor_shop_product():
    v = parse_video(raw(desc="look at this", anchors=[{"type": 54, "keyword": "CapCut · Editing made easy"}, _shop_anchor()]))
    assert v.product_title == "20Pcs Christmas Gift Set" and v.has_product
    p = v.product_info
    assert p["product_id"] == "1732570618364072053"
    assert p["url"].startswith("https://shop.tiktok.com/us/pdp/")
    assert p["category"] == "Home Supplies › Party Bags & Party Favors"
    assert p["image"] == "https://img.example/cover.jpeg" and p["price"] is None


def test_capcut_anchor_is_not_a_product():
    d = raw(desc="my morning routine", anchors=[{"type": 54, "keyword": "CapCut · Editing made easy"},
                                               {"type": 28, "keyword": "Green Screen"}])
    d["challenges"] = [{"title": "fyp"}]
    v = parse_video(d)
    assert v.product_title is None and v.product_info is None and not v.has_product


def test_no_product_signal():
    d = raw(desc="my dog doing a backflip")
    d["challenges"] = [{"title": "dogsoftiktok"}]
    v = parse_video(d)
    assert not v.has_product
    cfg = Config()
    cfg.require_shop_product = False
    assert passes_collect_filter(v, cfg, NOW) == (False, "no_product")


def test_filters():
    cfg = Config()
    cfg.require_shop_product = False
    assert passes_collect_filter(parse_video(raw()), cfg, NOW) == (True, "ok")
    assert passes_collect_filter(parse_video(raw(hours_old=24 * 8)), cfg, NOW)[1] == "too_old"
    assert passes_collect_filter(parse_video(raw(views=5_000)), cfg, NOW)[1] == "low_views"
    # 30k views over 6.5 days = ~190/h, below 500/h
    assert passes_collect_filter(parse_video(raw(hours_old=156, views=30_000)), cfg, NOW)[1] == "slow"


def test_unparsable():
    assert parse_video({"id": "1"}) is None


def test_tracking_decision():
    cfg = Config()
    created = NOW - timedelta(hours=30)
    fast = [(NOW, 200_000), (NOW - timedelta(hours=6), 100_000), (NOW - timedelta(hours=12), 50_000)]
    slow = [(NOW, 100_500), (NOW - timedelta(hours=6), 100_000), (NOW - timedelta(hours=12), 99_000)]
    assert tracking_decision(created, fast, cfg, NOW) == "tracking"
    assert tracking_decision(created, slow, cfg, NOW) == "dropped"
    # too few snapshots: never dropped yet
    assert tracking_decision(created, slow[:2], cfg, NOW) == "tracking"
    assert tracking_decision(NOW - timedelta(days=8), fast, cfg, NOW) == "expired"


def test_proxy_settings():
    pw, req = proxy_settings("http://u:p@proxy.example.com:8080")
    assert pw == {"server": "http://proxy.example.com:8080", "username": "u", "password": "p"}
    assert req["https"] == "http://u:p@proxy.example.com:8080"
    assert proxy_settings(None) == (None, None)


def test_apply_overrides():
    cfg = Config()
    applied = cfg.apply_overrides({
        "min_views": 50000, "include_trending": False, "hashtags": ["#Kitchen Gadgets", "petfinds", ""],
        "max_age_days": "9", "unknown": 1, "min_snapshots_before_drop": True,
    })
    assert cfg.min_views == 50000 and cfg.include_trending is False
    assert cfg.hashtags == ["kitchengadgets", "petfinds"]
    assert cfg.max_age_days == 7  # string rejected
    assert cfg.min_snapshots_before_drop == 3  # bool is not an int here
    assert set(applied) == {"min_views", "include_trending", "hashtags"}


def test_strip_signed_params():
    from tiktok_patch import strip_signed_params
    u = "https://www.tiktok.com/api/challenge/item_list/?aid=1988&challengeID=123&msToken=abc&X-Bogus=xyz&count=30"
    out = strip_signed_params(u)
    assert "msToken" not in out and "X-Bogus" not in out
    assert "aid=1988" in out and "challengeID=123" in out and "count=30" in out


def test_parse_video_page():
    import json as _json
    import pytest
    from fetch_video import UNIVERSAL, VideoUnavailable, parse_video_page
    item = {"id": "7550000000000000001", "createTime": "1760400000", "author": {"uniqueId": "seller"},
            "desc": "x", "stats": {"playCount": 1234}}
    page = {"__DEFAULT_SCOPE__": {"webapp.video-detail": {"statusCode": 0, "itemInfo": {"itemStruct": item}}}}
    html = f"<html>{UNIVERSAL}{_json.dumps(page)}</script></html>"
    assert parse_video_page(html, item["id"])["stats"]["playCount"] == 1234
    gone = {"__DEFAULT_SCOPE__": {"webapp.video-detail": {"statusCode": 10204}}}
    with pytest.raises(VideoUnavailable):
        parse_video_page(f"{UNIVERSAL}{_json.dumps(gone)}</script>", item["id"])
    with pytest.raises(VideoUnavailable):
        parse_video_page("<html>blocked</html>", item["id"])


def test_fetch_video_retries(monkeypatch):
    import fetch_video
    calls = []

    class R:
        status_code = 503
        text = ""

    monkeypatch.setattr(fetch_video.requests, "get", lambda *a, **k: calls.append(1) or R())
    monkeypatch.setattr(fetch_video.time, "sleep", lambda s: None)
    import pytest
    with pytest.raises(RuntimeError):
        fetch_video.fetch_video("https://x", "1", None, attempts=3)
    assert len(calls) == 3


def test_parse_product_page():
    import json as _j
    from fetch_product import parse_product_page, ProductUnavailable
    import pytest
    data = {"components": [{"price": {"symbol_position": 1, "is_interval_price": True, "real_price": "$22.43 - 185.98",
                                      "currency": "USD", "min_sku_price": "22.43", "max_sku_price": "263.98",
                                      "min_sku_original_price": "43.98"}},
                           {"product_info": {"status": 1, "sold_count": "4402", "product_id": "1729511811452409061",
                                             "title": "Rug"}}]}
    # embedded the way the page does it: JSON inside a JSON string
    html = '<script id="__MODERN_ROUTER_DATA__">' + _j.dumps({"x": _j.dumps(data)}) + "</script>"
    out = parse_product_page(html, "1729511811452409061")
    assert out["price_min"] == 22.43 and out["price_max"] == 263.98 and out["price_original"] == 43.98
    assert out["sold"] == 4402 and out["price_display"] == "$22.43 - 185.98"
    with pytest.raises(ProductUnavailable):
        parse_product_page("<html>nothing</html>", "1")


def test_require_shop_product():
    cfg = Config()
    assert cfg.require_shop_product
    no_shop = parse_video(raw())  # product words in caption, but no TikTok Shop product linked
    assert passes_collect_filter(no_shop, cfg, NOW) == (False, "no_shop_product")
    shop = parse_video(raw(anchors=[_shop_anchor()]))
    assert passes_collect_filter(shop, cfg, NOW) == (True, "ok")
    cfg.require_shop_product = False
    assert passes_collect_filter(no_shop, cfg, NOW) == (True, "ok")


def test_parse_category_page():
    import json as _j
    from shop import parse_category_page, category_name, in_range
    page = {"component_data": {"categoryInfo": {"category_name": "Kitchen Appliances"},
            "self": {"category_id": "844168", "category_name": "Kitchen Appliances"},
            "categoryProductsData": {"productList": [
        {"product_id": "1732473869581718155", "title": "Ice Cream Maker & Scrapers",
         "image": {"url_list": ["https://img.example/a.webp"]},
         "product_price_info": {"sale_price_decimal": "39.2", "raw_origin_price_decimal": "59.99"},
         "rate_info": {"score": 4.2, "review_count": "75"}, "sold_info": {"sold_count": 333},
         "seller_info": {"seller_id": "7494353230127007371", "shop_name": "Buifast"},
         "seo_url": {"canonical_url": "https://shop.tiktok.com/us/pdp/ice-cream/1732473869581718155"}},
        {"product_id": "1731638169038590399", "title": "Cheap 10.5\" Peeler",
         "product_price_info": {"sale_price_decimal": "9.2"}, "sold_info": {"sold_count": 12}}]}}}
    html = '<script>' + _j.dumps({"x": _j.dumps(page)}) + "</script>"
    items = parse_category_page(html)
    assert [i["product_id"] for i in items] == ["1732473869581718155", "1731638169038590399"]
    a = items[0]
    assert a["title"] == "Ice Cream Maker & Scrapers" and a["price"] == 39.2 and a["price_original"] == 59.99
    assert a["sold"] == 333 and a["rating"] == 4.2 and a["reviews"] == 75 and a["shop_name"] == "Buifast"
    assert a["url"].endswith("/1732473869581718155") and a["image"] == "https://img.example/a.webp"
    assert category_name(html) == "Kitchen Appliances"
    cfg = Config(); cfg.shop_min_price, cfg.shop_max_price = 30, 70
    assert in_range(items[0], cfg) and not in_range(items[1], cfg)
    assert items[1]["title"] == 'Cheap 10.5" Peeler'


def test_shop_categories_setting():
    cfg = Config()
    cfg.apply_overrides({"shop_categories": ["kitchen-appliances/844168", "bad cat", "/fitness/835336/"], "shop_min_price": 30})
    assert cfg.shop_categories == ["kitchen-appliances/844168", "fitness/835336"] and cfg.shop_min_price == 30
