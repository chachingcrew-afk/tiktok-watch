"""Pure logic: config, video parsing, filtering and scoring. No network or DB here, so it can be unit tested."""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from urllib.parse import urlparse


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass
class Config:
    # Where to look for new videos (hashtag names without #)
    hashtags: list[str] = field(default_factory=lambda: [
        h.strip() for h in os.environ.get(
            "HASHTAGS",
            "tiktokmademebuyit,tiktokshopfinds,amazonfinds,founditontiktok,"
            "musthaves,giftideas,gadgets,lifehacks,cleaninghacks,homefinds,"
            "kitchengadgets,beautyfinds,tiktokshop,viralproducts",
        ).split(",") if h.strip()
    ])
    videos_per_hashtag: int = _env_int("VIDEOS_PER_HASHTAG", 120)
    include_trending: bool = os.environ.get("INCLUDE_TRENDING", "1") == "1"
    trending_count: int = _env_int("TRENDING_COUNT", 150)

    # Collection criteria
    max_age_days: int = _env_int("MAX_AGE_DAYS", 7)
    min_views: int = _env_int("MIN_VIEWS", 20_000)
    min_avg_views_per_hour: int = _env_int("MIN_AVG_VIEWS_PER_HOUR", 500)
    require_product_signal: bool = os.environ.get("REQUIRE_PRODUCT_SIGNAL", "1") == "1"
    # Only keep videos with a real TikTok Shop product linked (price, sales and link available)
    require_shop_product: bool = os.environ.get("REQUIRE_SHOP_PRODUCT", "1") == "1"

    # Tracking: drop a video when its last 6h velocity falls below this (after MIN_SNAPSHOTS_BEFORE_DROP checks)
    drop_below_views_per_hour: int = _env_int("DROP_BELOW_VIEWS_PER_HOUR", 300)
    min_snapshots_before_drop: int = _env_int("MIN_SNAPSHOTS_BEFORE_DROP", 3)
    max_fail_count: int = _env_int("MAX_FAIL_COUNT", 4)

    # Products: re-read price and units sold at most this often; hide products whose most
    # expensive variant is cheaper than min_product_price dollars (0 = off). Starred ones are kept.
    product_check_hours: int = _env_int("PRODUCT_CHECK_HOURS", 20)
    min_product_price: int = _env_int("MIN_PRODUCT_PRICE", 0)

    # TikTok Shop category scan (shop.py)
    shop_categories: list[str] = field(default_factory=list)
    shop_min_price: int = _env_int("SHOP_MIN_PRICE", 30)
    shop_max_price: int = _env_int("SHOP_MAX_PRICE", 70)
    shop_fetches_per_category: int = _env_int("SHOP_FETCHES_PER_CATEGORY", 3)
    shop_track_min_sold: int = _env_int("SHOP_TRACK_MIN_SOLD", 100)

    # Women's clothing: scanned harder (more loads per category), with its own price band;
    # products of known brands are not kept.
    fashion_categories: list[str] = field(default_factory=list)
    fashion_min_price: int = _env_int("FASHION_MIN_PRICE", 20)
    fashion_max_price: int = _env_int("FASHION_MAX_PRICE", 70)
    fashion_fetches_per_category: int = _env_int("FASHION_FETCHES_PER_CATEGORY", 10)
    known_brands: list[str] = field(default_factory=list)

    # Keys the dashboard may change, with their expected type
    EDITABLE = {
        "hashtags": list, "videos_per_hashtag": int, "include_trending": bool, "trending_count": int,
        "max_age_days": int, "min_views": int, "min_avg_views_per_hour": int,
        "require_product_signal": bool, "require_shop_product": bool, "drop_below_views_per_hour": int, "min_snapshots_before_drop": int,
        "product_check_hours": int, "min_product_price": int,
        "shop_categories": "categories", "shop_min_price": int, "shop_max_price": int,
        "shop_fetches_per_category": int, "shop_track_min_sold": int,
        "fashion_categories": "categories", "fashion_min_price": int, "fashion_max_price": int,
        "fashion_fetches_per_category": int, "known_brands": "names",
    }

    def apply_overrides(self, values: dict) -> list[str]:
        """Apply settings from the database. Ignores unknown keys and wrong types. Returns applied keys."""
        applied = []
        for key, value in values.items():
            kind = self.EDITABLE.get(key)
            if kind is None:
                continue
            if kind is bool and isinstance(value, bool):
                setattr(self, key, value)
            elif kind is int and isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0:
                setattr(self, key, int(value))
            elif kind == "categories" and isinstance(value, list):
                cats = [str(x).strip().strip("/") for x in value if re.fullmatch(r"[a-z0-9\-]+/\d+", str(x).strip().strip("/"))]
                if not cats:
                    continue
                setattr(self, key, cats)
            elif kind == "names" and isinstance(value, list):
                names = [str(x).strip()[:60] for x in value if str(x).strip()]
                if not names:
                    continue
                setattr(self, key, names)
            elif kind is list and isinstance(value, list):
                tags = [re.sub(r"[^a-z0-9_]", "", str(t).lower().lstrip("#")) for t in value]
                tags = [t for t in tags if t]
                if tags:
                    setattr(self, key, tags)
            else:
                continue
            applied.append(key)
        return applied


# Words in captions/hashtags that suggest the video sells or shows a buyable product
PRODUCT_WORDS = [
    "link in bio", "linkinbio", "tiktok shop", "tiktokshop", "orange cart", "shop now",
    "made me buy", "madembuyit", "madmebuyit", "madethemebuyit", "tiktokmademebuyit",
    "amazon", "amazonfinds", "founditon", "must have", "musthave", "gadget", "finds",
    "product", "gift idea", "giftidea", "on sale", "% off", "discount", "restock",
    "game changer", "gamechanger", "worth it", "best purchase", "where to buy",
]


@dataclass
class ParsedVideo:
    video_id: str
    author: str
    description: str
    url: str
    created_at: datetime
    hashtags: list[str]
    views: int
    likes: int
    comments: int
    shares: int
    saves: int
    has_product: bool
    product_title: str | None
    product_info: dict | None


def _int(v) -> int:
    try:
        return int(v or 0)
    except (TypeError, ValueError):
        return 0


def _json_maybe(val):
    if isinstance(val, str):
        try:
            return json.loads(val)
        except ValueError:
            return None
    return val


def _shop_product(d: dict) -> dict | None:
    """Normalize one TikTok Shop product payload (the inner 'extra' of a type-33 anchor)."""
    pid = d.get("product_id")
    if not pid:
        return None
    pid = str(pid)
    price = d.get("price") or d.get("min_price")
    cats = [c.get("category_name") for c in (d.get("categories") or []) if isinstance(c, dict) and c.get("category_name")]
    img_url = d.get("img_url")
    image = d.get("cover_url") or (img_url[0] if isinstance(img_url, list) and img_url else None)
    return {
        "product_id": pid,
        "title": (d.get("title") or d.get("elastic_title") or "").strip()[:500] or None,
        "url": d.get("seo_url") or f"https://shop.tiktok.com/view/product/{pid}?region=US",
        "image": image,
        "category": " › ".join(cats) or None,
        "seller_id": str(d["seller_id"]) if d.get("seller_id") else None,
        "price": price if isinstance(price, (int, float)) and price > 0 else None,
        "currency": d.get("currency"),
    }


def _product_from_anchors(data: dict) -> tuple[str | None, dict | None]:
    """Return (product title, normalized product) for a video's linked TikTok Shop product.

    TikTok Shop products sit in anchors of type 35, whose 'extra' is a JSON list of type-33 items,
    each with its own JSON 'extra' holding the product. Other anchors (CapCut templates, green
    screen effects, ...) are not products and are ignored.
    """
    for anchor in data.get("anchors") or []:
        if not isinstance(anchor, dict):
            continue
        for item in _json_maybe(anchor.get("extra")) or []:
            if not isinstance(item, dict) or str(item.get("type")) != "33":
                continue
            inner = _json_maybe(item.get("extra"))
            product = _shop_product(inner) if isinstance(inner, dict) else None
            if product:
                product["title"] = product["title"] or (item.get("keyword") or "").strip() or None
                return product["title"], product
    return None, None


def parse_video(data: dict) -> ParsedVideo | None:
    """Turn a TikTokApi video dict (video.as_dict) into a ParsedVideo."""
    vid = str(data.get("id") or "")
    create_ts = _int(data.get("createTime"))
    if not vid or not create_ts:
        return None
    author = data.get("author") or {}
    username = author.get("uniqueId") if isinstance(author, dict) else str(author)
    stats = data.get("statsV2") or data.get("stats") or {}
    desc = data.get("desc") or ""
    tags = [c.get("title", "") for c in data.get("challenges", []) if isinstance(c, dict)]
    if not tags:
        tags = re.findall(r"#(\w+)", desc)
    product_title, product_info = _product_from_anchors(data)
    text = (desc + " " + " ".join(tags)).lower()
    keyword_hit = any(w in text for w in PRODUCT_WORDS)
    return ParsedVideo(
        video_id=vid,
        author=username or "",
        description=desc,
        url=f"https://www.tiktok.com/@{username}/video/{vid}" if username else f"https://www.tiktok.com/video/{vid}",
        created_at=datetime.fromtimestamp(create_ts, tz=timezone.utc),
        hashtags=[t.lower() for t in tags if t],
        views=_int(stats.get("playCount")),
        likes=_int(stats.get("diggCount")),
        comments=_int(stats.get("commentCount")),
        shares=_int(stats.get("shareCount")),
        saves=_int(stats.get("collectCount")),
        has_product=bool(product_info) or keyword_hit,
        product_title=product_title,
        product_info=product_info,
    )


def age_hours(v: ParsedVideo, now: datetime) -> float:
    return max((now - v.created_at).total_seconds() / 3600.0, 1.0)


def passes_collect_filter(v: ParsedVideo, cfg: Config, now: datetime) -> tuple[bool, str]:
    """Return (ok, reason). Reason explains the first failing criterion."""
    hours = age_hours(v, now)
    if hours > cfg.max_age_days * 24:
        return False, "too_old"
    if v.views < cfg.min_views:
        return False, "low_views"
    if v.views / hours < cfg.min_avg_views_per_hour:
        return False, "slow"
    if cfg.require_shop_product and not (v.product_info or {}).get("product_id"):
        return False, "no_shop_product"
    if cfg.require_product_signal and not v.has_product:
        return False, "no_product"
    return True, "ok"


def tracking_decision(created_at: datetime, snapshots: list[tuple[datetime, int]], cfg: Config,
                      now: datetime) -> str:
    """Decide what happens to a tracked video after a new snapshot.

    snapshots: list of (taken_at, views), newest first, including the one just taken.
    Returns 'tracking', 'expired' or 'dropped'.
    """
    if (now - created_at).total_seconds() > cfg.max_age_days * 86400:
        return "expired"
    if len(snapshots) >= cfg.min_snapshots_before_drop and len(snapshots) >= 2:
        (t1, v1), (t0, v0) = snapshots[0], snapshots[1]
        hours = max((t1 - t0).total_seconds() / 3600.0, 0.5)
        if (v1 - v0) / hours < cfg.drop_below_views_per_hour:
            return "dropped"
    return "tracking"


def proxy_settings(proxy_url: str | None) -> tuple[dict | None, dict | None]:
    """PROXY_URL like http://user:pass@host:port -> (playwright proxy dict, requests proxies dict)."""
    if not proxy_url:
        return None, None
    p = urlparse(proxy_url)
    pw = {"server": f"{p.scheme}://{p.hostname}:{p.port}"}
    if p.username:
        pw["username"] = p.username
        pw["password"] = p.password or ""
    return pw, {"http": proxy_url, "https": proxy_url}


# Names that are only brands when the shop itself carries them ("Dash cam", "Bear plush" are not brands).
BRAND_AMBIGUOUS = {"Dash", "Bear", "Snow", "Instant", "Ring", "Bella", "PINK", "Alo", "Express", "Garage", "Target", "Coach", "Guess"}


def _norm(x: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (x or "").lower())


def brand_of(title: str | None, shop_name: str | None, brands: list[str]) -> str | None:
    """The known brand a product belongs to: its title starts with the brand, or the shop is named
    after it ("Halara", "Halara Official", "halara.us"). Same rule as the website."""
    t = re.sub(r"^(\s|【[^】]*】|\[[^\]]*\]|\([^)]*\))+", "", title or "")
    shop = _norm(shop_name)
    for b in brands:
        nb = _norm(b)
        if not nb:
            continue
        if shop and shop in {nb, nb + "official", nb + "officialstore", nb + "store", nb + "us", nb + "usa", nb + "direct", nb + "shop"}:
            return b
        if b not in BRAND_AMBIGUOUS and re.match(re.escape(b) + r"(?![a-z0-9])", t, re.I):
            return b
    return None
