"""Find the same product sold by several shops.

A product that several unrelated shops sell, with the same photos or nearly the same title, comes
from a common factory: a strong sign that it is generic and can be sourced (AliExpress, CJ), unlike
a product someone designed and manufactures themselves.

Two listings of different sellers count as the same product when their titles share most of their
words, or their main photos are nearly identical and the titles are related.
"""
from __future__ import annotations

import base64
import io
import logging
import re

log = logging.getLogger("tiktok-watch")
IMG_MAX_BITS = 24        # of 256; re-encoded copies of one photo stay well under this
IMG_MIN_JACCARD = 0.3    # a photo match also needs related titles
TITLE_MIN_JACCARD = 0.75
STOP = {"for", "with", "and", "the", "a", "an", "of", "to", "in", "on", "set", "pack", "pcs", "pc", "new",
        "&", "-", "|", "+", "x", "1", "2", "3", "4", "5", "6"}


def dhash(webp_b64: str, size: int = 8) -> int | None:
    """Difference hash of an image: size*size bits (8 -> 64-bit, 16 -> 256-bit)."""
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(base64.b64decode(webp_b64))).convert("L").resize((size + 1, size), Image.LANCZOS)
    except Exception:
        return None
    px = list(img.getdata())
    bits = 0
    for row in range(size):
        for col in range(size):
            bits = (bits << 1) | (px[row * (size + 1) + col] > px[row * (size + 1) + col + 1])
    if size == 8 and bits >= (1 << 63):
        bits -= 1 << 64  # fit a signed bigint
    return bits


def words(title: str | None) -> frozenset[str]:
    toks = re.findall(r"[a-z0-9]+", (title or "").lower())
    return frozenset(t for t in toks if t not in STOP and len(t) > 1)


def jaccard(a: frozenset, b: frozenset) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def same_product(a: dict, b: dict) -> bool:
    """Same photo (256-bit hash nearly identical) AND related titles, or near-identical titles.

    Plain product shots on white look alike at small sizes, so a photo match alone is not enough."""
    j = jaccard(a["words"], b["words"])
    if len(a["words"]) >= 4 and len(b["words"]) >= 4 and j >= TITLE_MIN_JACCARD:
        return True
    ha, hb = a.get("hash"), b.get("hash")
    if ha is not None and hb is not None and bin(ha ^ hb).count("1") <= IMG_MAX_BITS:
        return j >= IMG_MIN_JACCARD
    return False


def shop_key(name: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def same_owner(a: dict, b: dict) -> bool:
    """Shops of one seller (same seller id, or names starting with the same word: 'VEVOR Store' / 'VEVOR Home Store')."""
    if a.get("seller_id") and a.get("seller_id") == b.get("seller_id"):
        return True
    ka, kb = shop_key(a["shop_name"]), shop_key(b["shop_name"])
    if not ka or not kb or ka == kb:
        return True
    fa = re.findall(r"[a-z0-9]+", (a["shop_name"] or "").lower())
    fb = re.findall(r"[a-z0-9]+", (b["shop_name"] or "").lower())
    if fa and fb and len(fa[0]) >= 4 and (fa[0] == fb[0] or ka.startswith(fb[0]) or kb.startswith(fa[0])):
        return True
    return False


def find_twins(products: list[dict]) -> dict[str, set[str]]:
    """product_id -> names of OTHER shops (other sellers) selling the same product."""
    out: dict[str, set[str]] = {p["product_id"]: set() for p in products}
    for i, a in enumerate(products):
        for b in products[i + 1:]:
            if same_owner(a, b):
                continue
            if same_product(a, b):
                out[a["product_id"]].add(b["shop_name"])
                out[b["product_id"]].add(a["shop_name"])
    return out


def run(conn, stats) -> None:
    with conn.cursor() as cur:
        cur.execute("select product_id, shop_name, seller_id, title, thumb from tiktok_watch.shop_products"
                    " where last_seen > now() - interval '60 days'")
        products = [{"product_id": r[0], "shop_name": r[1], "seller_id": r[2], "words": words(r[3]),
                     "hash": dhash(r[4], 16) if r[4] else None} for r in cur.fetchall()]
        twins = find_twins(products)
        cur.executemany(
            "update tiktok_watch.shop_products set other_shops = %s, twin_shops = %s where product_id = %s",
            [(len(s), sorted(s)[:10] or None, pid) for pid, s in twins.items()])
        conn.commit()
    stats["multi_shop_products"] += sum(1 for s in twins.values() if s)


if __name__ == "__main__":
    from collections import Counter

    import db
    from session import setup_logging

    setup_logging()
    conn = db.connect()
    stats: Counter = Counter()
    run_id = db.start_run(conn, "twins")
    run(conn, stats)
    db.finish_run(conn, run_id, True, dict(stats))
    log.info("Done. %s", dict(stats))
