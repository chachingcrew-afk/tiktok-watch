"""Count what goes through the paid proxy, so each run can report its proxy usage.

Sizes are what the server sent on the wire (Content-Length, usually gzip-compressed), which is what
the proxy provider bills; when a response has no Content-Length the decoded size is used instead.
"""
from __future__ import annotations

import threading

import requests

_lock = threading.Lock()
PROXY = {"requests": 0, "bytes": 0}
DIRECT = {"requests": 0, "ok": 0}


def add_proxy_bytes(n: int) -> None:
    with _lock:
        PROXY["requests"] += 1
        PROXY["bytes"] += max(int(n or 0), 0)


def wire_size(r: requests.Response) -> int:
    try:
        return int(r.headers.get("content-length")) + 600  # + rough header size
    except (TypeError, ValueError):
        return len(r.content) + 600


def get(url: str, proxies: dict | None = None, **kw) -> requests.Response:
    r = requests.get(url, proxies=proxies, **kw)
    if proxies:
        add_proxy_bytes(wire_size(r))
    else:
        with _lock:
            DIRECT["requests"] += 1
            if r.status_code == 200:
                DIRECT["ok"] += 1
    return r


def summary() -> dict:
    return {"proxy_requests": PROXY["requests"], "proxy_mb": round(PROXY["bytes"] / 1e6, 1),
            "direct_requests": DIRECT["requests"]}
