"""Download half-hourly grid carbon intensity (UK Carbon Intensity API) and save hourly means.

    python fetch_carbon.py --start 2019-08-01 --end 2019-10-23 --out ../../dataset/processed/carbon_hourly.csv

API: https://carbon-intensity.github.io/api-definitions/  (free, no key, CC BY 4.0). Max 14 days per request, so 13-day chunks are fetched and cached in <out>.chunks/ so a dropped connection resumes.
Output columns: ts (UTC, hourly), gco2_per_kwh. Uses intensity.actual, falls back to intensity.forecast when actual is missing.
"""
import argparse, csv, json, os, sys, time, urllib.request, urllib.error
from collections import defaultdict
from datetime import datetime, timedelta, timezone

BASE = "https://api.carbonintensity.org.uk/intensity"
FMT = "%Y-%m-%dT%H:%MZ"

def fetch(url, tries=5):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return json.load(r)
        except (urllib.error.URLError, TimeoutError) as e:
            wait = 2 ** i
            print(f"  retry in {wait}s ({e})", file=sys.stderr)
            time.sleep(wait)
    raise SystemExit(f"Giving up on {url}")

def parse(payload):
    rows = []
    for d in payload.get("data", []):
        ci = d.get("intensity") or {}
        actual, forecast = ci.get("actual"), ci.get("forecast")
        val = actual if actual is not None else forecast
        if val is None:
            continue
        t = datetime.strptime(d["from"], FMT).replace(tzinfo=timezone.utc)
        rows.append((t, float(val), actual is None))
    return rows

def hourly(rows):
    buckets = defaultdict(list)
    for t, v, _ in rows:
        buckets[t.replace(minute=0, second=0, microsecond=0)].append(v)
    return sorted((t, sum(v) / len(v)) for t, v in buckets.items())

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", required=True)
    ap.add_argument("--end", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    start = datetime.fromisoformat(a.start).replace(tzinfo=timezone.utc)
    end = datetime.fromisoformat(a.end).replace(tzinfo=timezone.utc)
    cache = a.out + ".chunks"
    os.makedirs(cache, exist_ok=True)
    all_rows, cur = [], start
    while cur < end:
        nxt = min(cur + timedelta(days=13), end)
        f = os.path.join(cache, cur.strftime("%Y%m%d") + ".json")
        if os.path.exists(f):
            payload = json.load(open(f))
        else:
            print(f"fetching {cur:%Y-%m-%d} -> {nxt:%Y-%m-%d}")
            payload = fetch(f"{BASE}/{cur.strftime(FMT)}/{nxt.strftime(FMT)}")
            json.dump(payload, open(f, "w"))
            time.sleep(0.5)
        all_rows += parse(payload)
        cur = nxt
    if not all_rows:
        raise SystemExit("No data returned. Check the dates and the API docs.")
    fallback = sum(1 for r in all_rows if r[2])
    out = hourly(all_rows)
    with open(a.out, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["ts", "gco2_per_kwh"])
        for t, v in out:
            w.writerow([t.strftime("%Y-%m-%dT%H:00:00Z"), round(v, 1)])
    print(f"wrote {len(out)} hours to {a.out}; {fallback}/{len(all_rows)} half-hours used the API forecast value")

if __name__ == "__main__":
    main()
