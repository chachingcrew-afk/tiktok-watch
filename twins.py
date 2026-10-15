"""Find the same product sold by several shops.

A product that several unrelated shops sell, with the same photos or nearly the same title, comes
from a common factory: a strong sign that it is generic and can be sourced (AliExpress, CJ), unlike
a product someone designed and manufactures themselves.

Two listings count as the same product when their main images look alike (difference hash of the
96px thumbnail, a few bits apart) or their titles share most of their words.
"""
from __future__ import annotations

import base64
import io
import logging
import re

log = logging.getLogger("tiktok-watch")
HASH_MAX_BITS = 6        # of 64; resized/re-encoded copies of one photo stay well under this
TITLE_MIN_JACCARD = 0.75
STOP = {"for", "with", "and", "the", "a", "an", "of", "to", "in", "on", "set", "pack", "pcs", "pc", "new",
        "&", "-", "|", "+", "x", "1", "2", "3", "4", "5", "6"}


def dhash(webp_b64: str) -> int | None:
    """64-bit difference hash of an image."""
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(base64.b64decode(webp_b64))).convert("L").resize((9, 8), Image.LANCZOS)
    except Exception:
        return None
    px = list(img.getdata())
    bits = 0
    for row in range(8):
        for col in range(8):
            bits = (bits << 1) | (px[row * 9 + col] > px[row * 9 + col + 1])
    return bits - (1 << 64) if bits >= (1 << 63) else bits  # fit a signed bigint


def words(title: str | None) -> frozenset[str]:
    toks = re.findall(r"[a-z0-9]+", (title or "").lower())
    return frozenset(t for t in toks if t not in STOP and len(t) > 1)


def same_product(a: dict, b: dict) -> bool:
    if a["phash"] is not None and b["phash"] is not None:
        if bin((a["phash"] ^ b["phash"]) & ((1 << 64) - 1)).count("1") <= HASH_MAX_BITS:
            return True
    wa, wb = a["words"], b["words"]
    if len(wa) >= 4 and len(wb) >= 4:
        return len(wa & wb) / len(wa | wb) >= TITLE_MIN_JACCARD
    return False


def shop_key(name: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def find_twins(products: list[dict]) -> dict[str, set[str]]:
    """product_id -> names of OTHER shops selling the same product."""
    out: dict[str, set[str]] = {p["product_id"]: set() for p in products}
    for i, a in enumerate(products):
        for b in products[i + 1:]:
            ka, kb = shop_key(a["shop_name"]), shop_key(b["shop_name"])
            if not ka or not kb or ka == kb:
                continue
            if same_product(a, b):
                out[a["product_id"]].add(b["shop_name"])
                out[b["product_id"]].add(a["shop_name"])
    return out


def run(conn, stats) -> None:
    with conn.cursor() as cur:
        cur.execute("select product_id, thumb from tiktok_watch.shop_products where phash is null and thumb is not null")
        for pid, thumb in cur.fetchall():
            h = dhash(thumb)
            if h is not None:
                cur.execute("update tiktok_watch.shop_products set phash = %s where product_id = %s", (h, pid))
                stats["phashes"] += 1
        conn.commit()
        cur.execute("select product_id, shop_name, title, phash from tiktok_watch.shop_products where last_seen > now() - interval '60 days'")
        products = [{"product_id": r[0], "shop_name": r[1], "words": words(r[2]), "phash": r[3]} for r in cur.fetchall()]
        twins = find_twins(products)
        for pid, shops in twins.items():
            cur.execute("update tiktok_watch.shop_products set other_shops = %s, twin_shops = %s where product_id = %s",
                        (len(shops), sorted(shops)[:10] or None, pid))
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
