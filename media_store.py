"""Cloudflare R2 (S3 compatible) storage for files that must not live in the database: Facebook ad
images and videos. Needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET; without
them enabled() is False and nothing is stored."""
from __future__ import annotations

import io
import os

import requests

_client = None


def enabled() -> bool:
    return all(os.environ.get(k) for k in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"))


def client():
    global _client
    if _client is None:
        import boto3
        _client = boto3.client("s3", endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
                               aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"], aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
                               region_name="auto")
    return _client


def put(key: str, data: bytes, content_type: str) -> str:
    client().put_object(Bucket=os.environ["R2_BUCKET"], Key=key, Body=data, ContentType=content_type,
                        CacheControl="public, max-age=31536000, immutable")
    return key


def download(url: str, max_bytes: int, proxies: dict | None = None, timeout: int = 40) -> bytes | None:
    """Fetch a file, giving up when it is bigger than max_bytes."""
    with requests.get(url, stream=True, timeout=timeout, proxies=proxies,
                      headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"}) as r:
        if r.status_code != 200:
            return None
        if int(r.headers.get("content-length") or 0) > max_bytes:
            return None
        buf = io.BytesIO()
        for chunk in r.iter_content(256 * 1024):
            buf.write(chunk)
            if buf.tell() > max_bytes:
                return None
        return buf.getvalue()


def webp(data: bytes, max_side: int = 720, quality: int = 78) -> bytes | None:
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(data)).convert("RGB")
        img.thumbnail((max_side, max_side))
        out = io.BytesIO()
        img.save(out, "WEBP", quality=quality, method=4)
        return out.getvalue()
    except Exception:
        return None
