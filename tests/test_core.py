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


def test_anchor_product_title():
    v = parse_video(raw(desc="look at this", anchors=[{"keyword": "Portable Blender Pro", "type": 33}]))
    v.hashtags = []
    assert v.product_title == "Portable Blender Pro" and v.has_product


def test_no_product_signal():
    d = raw(desc="my dog doing a backflip")
    d["challenges"] = [{"title": "dogsoftiktok"}]
    v = parse_video(d)
    assert not v.has_product
    assert passes_collect_filter(v, Config(), NOW) == (False, "no_product")


def test_filters():
    cfg = Config()
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
