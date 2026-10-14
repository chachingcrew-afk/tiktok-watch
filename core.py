"""Pure logic: config, video parsing, filtering and scoring. No network or DB here, so it can be unit tested."""
from __future__ import annotations

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

    # Tracking: drop a video when its last 6h velocity falls below this (after MIN_SNAPSHOTS_BEFORE_DROP checks)
    drop_below_views_per_hour: int = _env_int("DROP_BELOW_VIEWS_PER_HOUR", 300)
    min_snapshots_before_drop: int = _env_int("MIN_SNAPSHOTS_BEFORE_DROP", 3)
    max_fail_count: int = _env_int("MAX_FAIL_COUNT", 4)

    # Keys the dashboard may change, with their expected type
    EDITABLE = {
        "hashtags": list, "videos_per_hashtag": int, "include_trending": bool, "trending_count": int,
        "max_age_days": int, "min_views": int, "min_avg_views_per_hour": int,
        "require_product_signal": bool, "drop_below_views_per_hour": int, "min_snapshots_before_drop": int,
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


def _product_from_anchors(data: dict) -> tuple[str | None, dict | None]:
    """TikTok Shop videos carry the product in 'anchors' (or similar fields). Return (title, raw)."""
    for key in ("anchors", "products", "productInfo", "shoppingInfo"):
        val = data.get(key)
        if not val:
            continue
        items = val if isinstance(val, list) else [val]
        for item in items:
            if not isinstance(item, dict):
                continue
            title = item.get("keyword") or item.get("title") or item.get("description") or item.get("name")
            # anchor type 33/35 etc are shop products; accept any anchor that carries a title
            if title:
                return str(title)[:300], {"source_field": key, "item": item}
        return None, {"source_field": key, "items": items[:3]}
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
        has_product=bool(product_title or product_info) or keyword_hit,
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
