"""Parcel tracking for Orlivane orders through the 17TRACK API.

The tracking page (claude.ai artifact) copies the tracking numbers of fulfilled Shopify orders into
tiktok_watch.parcels. This job (GitHub Actions, every few hours):
  1. registers new numbers with 17TRACK (carrier auto detection),
  2. asks 17TRACK for the latest status of every parcel that is not delivered yet,
  3. stores status, last event and delivery time.
Needs TRACK17_KEY (17TRACK API security key) and DATABASE_URL.
"""
from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone

import requests

import db

API = "https://api.17track.net/track/v2.4"
BATCH = 40                 # 17TRACK accepts at most 40 numbers per call
RECHECK_HOURS = 3          # don't ask for the same parcel more often than this
GIVE_UP_DAYS = 90          # stop checking parcels shipped longer ago than this
ALREADY_REGISTERED = {-18019901}
NO_INFO_YET = {-18019909}  # registered, 17TRACK has not fetched the carrier yet: not an error


def call(key: str, path: str, body) -> dict:
    for attempt in range(4):
        r = requests.post(f"{API}/{path}", headers={"17token": key, "Content-Type": "application/json"},
                          data=json.dumps(body), timeout=60)
        if r.status_code == 429:
            time.sleep(2 + attempt * 2)
            continue
        r.raise_for_status()
        time.sleep(0.4)    # 3 requests per second at most
        return r.json()
    raise RuntimeError(f"17TRACK {path}: too many requests")


def ts(v) -> datetime | None:
    if not v:
        return None
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None


def chunks(xs, n):
    for i in range(0, len(xs), n):
        yield xs[i:i + n]


def register(conn, key: str, stats: dict) -> None:
    with conn.cursor() as cur:
        cur.execute("""select number from tiktok_watch.parcels
                       where registered_at is null and reg_tries < 5
                         and (fulfilled_at is null or fulfilled_at > now() - make_interval(days => %s))
                       order by fulfilled_at nulls last limit 400""", (GIVE_UP_DAYS,))
        todo = [r[0] for r in cur.fetchall()]
    for part in chunks(todo, BATCH):
        res = call(key, "register", [{"number": n} for n in part])
        data = res.get("data") or {}
        with conn.cursor() as cur:
            for a in data.get("accepted") or []:
                cur.execute("""update tiktok_watch.parcels set registered_at = now(), carrier = %s, reg_error = null,
                               reg_tries = reg_tries + 1, updated_at = now() where number = %s""", (a.get("carrier"), a.get("number")))
                stats["registered"] += 1
            for x in data.get("rejected") or []:
                err = x.get("error") or {}
                if err.get("code") in ALREADY_REGISTERED:
                    cur.execute("""update tiktok_watch.parcels set registered_at = coalesce(registered_at, now()), reg_error = null,
                                   updated_at = now() where number = %s""", (x.get("number"),))
                    stats["registered"] += 1
                else:
                    cur.execute("""update tiktok_watch.parcels set reg_error = %s, reg_tries = reg_tries + 1, updated_at = now()
                                   where number = %s""", (f"{err.get('code')}: {err.get('message')}", x.get("number")))
                    stats["reg_errors"] += 1
        conn.commit()


def parse(info: dict) -> dict:
    ti = info.get("track_info") or {}
    ls = ti.get("latest_status") or {}
    ev = ti.get("latest_event") or {}
    status = ls.get("status")
    ev_time = ts(ev.get("time_utc")) or ts(ev.get("time_iso"))
    delivered = None
    if status == "Delivered":
        delivered = ev_time
        for prov in ((ti.get("tracking") or {}).get("providers") or []):
            for e in prov.get("events") or []:
                if str(e.get("stage") or e.get("sub_status") or "").startswith("Delivered"):
                    delivered = ts(e.get("time_utc")) or ts(e.get("time_iso")) or delivered
                    break
        delivered = delivered or datetime.now(timezone.utc)
    return {
        "status": status, "sub_status": ls.get("sub_status"),
        "last_event": ev.get("description"), "last_location": ev.get("location"), "last_event_at": ev_time,
        "delivered_at": delivered,
        "raw": {"latest_status": ls, "latest_event": ev, "time_metrics": ti.get("time_metrics"), "misc_info": ti.get("misc_info")},
    }


def refresh(conn, key: str, stats: dict) -> None:
    with conn.cursor() as cur:
        cur.execute("""select number, carrier from tiktok_watch.parcels
                       where registered_at is not null and delivered_at is null
                         and (checked_at is null or checked_at < now() - make_interval(hours => %s))
                         and (fulfilled_at is null or fulfilled_at > now() - make_interval(days => %s))
                       order by checked_at nulls first limit 800""", (RECHECK_HOURS, GIVE_UP_DAYS))
        todo = cur.fetchall()
    for part in chunks(todo, BATCH):
        res = call(key, "gettrackinfo", [{"number": n, **({"carrier": c} if c else {})} for n, c in part])
        data = res.get("data") or {}
        with conn.cursor() as cur:
            for a in data.get("accepted") or []:
                p = parse(a)
                cur.execute(
                    """update tiktok_watch.parcels set status = %s, sub_status = %s, last_event = %s, last_location = %s,
                       last_event_at = %s, delivered_at = %s, raw = %s, checked_at = now(), updated_at = now(),
                       carrier = coalesce(%s, carrier) where number = %s""",
                    (p["status"], p["sub_status"], p["last_event"], p["last_location"], p["last_event_at"],
                     p["delivered_at"], db.Jsonb(p["raw"]), a.get("carrier"), a.get("number")))
                stats["checked"] += 1
                if p["delivered_at"]:
                    stats["delivered_now"] += 1
            for x in data.get("rejected") or []:
                err = x.get("error") or {}
                if err.get("code") in NO_INFO_YET:
                    cur.execute("update tiktok_watch.parcels set checked_at = now(), reg_error = null where number = %s", (x.get("number"),))
                    stats["no_info_yet"] = stats.get("no_info_yet", 0) + 1
                    continue
                cur.execute("update tiktok_watch.parcels set checked_at = now(), reg_error = %s where number = %s",
                            (f"{err.get('code')}: {err.get('message')}", x.get("number")))
                stats["check_errors"] += 1
        conn.commit()


def main() -> None:
    conn = db.connect()
    rid = db.start_run(conn, "parcels")
    stats = {"registered": 0, "reg_errors": 0, "checked": 0, "check_errors": 0, "delivered_now": 0}
    key = os.environ.get("TRACK17_KEY", "").strip()
    if not key:
        db.finish_run(conn, rid, False, stats, "TRACK17_KEY secret is missing")
        raise SystemExit("TRACK17_KEY secret is missing")
    try:
        register(conn, key, stats)
        refresh(conn, key, stats)
        try:
            stats["quota"] = (call(key, "getquota", {}).get("data") or {})
        except Exception as e:  # quota is only informative
            stats["quota_error"] = str(e)[:200]
        db.finish_run(conn, rid, True, stats)
    except Exception as e:
        conn.rollback()
        db.finish_run(conn, rid, False, stats, str(e)[:500])
        raise
    print(json.dumps(stats, default=str))


if __name__ == "__main__":
    main()
