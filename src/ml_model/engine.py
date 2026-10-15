"""On-demand AURA engine behind the dashboard API: runs the trained LSTM and the allocation logic on user inputs.

Three operations (see engine_server.py for the process the Node API talks to):
  simulate(params)            replay the forecast-driven, carbon-aware allocation over a date range
  preview(date, dataset)      the LSTM's 24 h forecast for one day, with the real reading where one exists
  upload(csv_text, name)      register a user's timestamp,kw series, rescaled to the model's range

Bad input raises ValidationError (message + offending field), which the API turns into a 400.
Forecasts depend only on the data, so they are cached per (dataset, day) across requests.
"""
import hashlib
import io
import json
import math
import os
import re
import tempfile
import time

import joblib
import numpy as np
import pandas as pd

from predict import forecast
from simulate import ASSUMPTIONS, CARBON_PROFILE, replay

ML_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(ML_DIR))
DATA_PATH = os.environ.get("AURA_DATA", os.path.join(ROOT, "dataset", "processed", "cubems_building_15min.csv"))
CARBON_PATH = os.environ.get("AURA_CARBON", os.path.join(ROOT, "dataset", "processed", "carbon_hourly.csv"))
MODEL_DIR = os.environ.get("AURA_MODEL", os.path.join(ROOT, "results", "model"))
UPLOAD_DIR = os.environ.get("AURA_UPLOAD_DIR", os.path.join(tempfile.gettempdir(), "aura_uploads"))

CUBEMS = "cubems"
MAX_DAYS = 31
MAX_EVENTS = 20
MAX_UPLOAD_ROWS = 600_000
MIN_UPLOAD_DAYS = 16  # one week of lookback + one week for the weekly-lag feature + at least a day to forecast

# Contract grids are fixed 24 h curves in gCO2/kWh by local hour; the extras use real or flat data.
GRID_CURVES = {
    "low": [95, 92, 90, 90, 92, 98, 110, 115, 95, 75, 60, 55, 52, 55, 62, 80, 110, 140, 150, 140, 125, 110, 102, 98],
    "medium": CARBON_PROFILE,
    "high": [640, 635, 630, 630, 635, 650, 680, 690, 670, 640, 620, 610, 605, 615, 635, 665, 700, 740, 760, 745, 720, 690, 665, 650],
    "india": [760, 750, 745, 745, 750, 765, 790, 760, 700, 650, 620, 610, 610, 625, 660, 710, 760, 800, 820, 810, 795, 785, 775, 765],
}
CARBON_GRIDS = {
    "low": "low-carbon grid (hydro/nuclear/solar mix, ~60-150 gCO2/kWh, midday solar dip)",
    "medium": "gas-heavy grid with a daytime solar dip (~490 gCO2/kWh)",
    "high": "fossil-heavy grid with an evening peak (~600-760 gCO2/kWh)",
    "india": "coal-heavy grid (~610-820 gCO2/kWh, midday solar dip, evening peak)",
    "uk-2019": "extra: real UK grid actuals, 2019-05-31 to 2019-10-23 (Carbon Intensity API)",
    "flat-low": "extra: constant 80 gCO2/kWh",
    "flat-high": "extra: constant 700 gCO2/kWh",
}
FLAT = {"flat-low": 80.0, "flat-high": 700.0}
# Calendar events apply to every day of the period. `known` events are planned, so the planner scales its LSTM
# forecast by them too; unplanned ones only hit the real demand and are absorbed by headroom and reactive scaling.
EVENTS = {
    "exam": dict(label="exam period", factor=1.30, hours=range(8, 20), weekdays_only=True, known=True),
    "break": dict(label="term break", factor=0.60, hours=range(0, 24), weekdays_only=False, known=True),
    "holiday": dict(label="public holiday", factor=0.45, hours=range(0, 24), weekdays_only=False, known=True),
    "event": dict(label="unplanned campus event", factor=1.30, hours=range(10, 16), weekdays_only=False, known=False),
}
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class ValidationError(ValueError):
    def __init__(self, message, field=None, kind="validation"):
        super().__init__(message)
        self.field = field
        self.kind = kind  # "validation" -> 400, "csv" -> 422, "too_large" -> 413


# ---- input helpers -------------------------------------------------------------------------------------------------

def _num(params, key, default, lo, hi, integer=False, lo_open=False):
    v = params.get(key, default)
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise ValidationError(f"{key} must be a number", key)
    if integer and v != int(v):
        raise ValidationError(f"{key} must be a whole number", key)
    if v < lo or v > hi or (lo_open and v == lo):
        raise ValidationError(f"{key} must be greater than {lo}" + (f" and at most {hi}" if hi < math.inf else "")
                              if lo_open else f"{key} must be between {lo} and {hi}", key)
    return int(v) if integer else float(v)


def _date(value, field):
    if not isinstance(value, str) or not DATE_RE.match(value):
        raise ValidationError(f"{field} must be a date formatted YYYY-MM-DD", field)
    try:
        return pd.Timestamp(value)
    except ValueError:
        raise ValidationError(f"{field} is not a real calendar date", field) from None


class Dataset:
    def __init__(self, ident, hourly, raw, label):
        self.id, self.hourly, self.raw, self.label = ident, hourly, raw, label
        valid = hourly.dropna()
        self.first = valid.index[0]
        self.last = valid.index[-1]
        # earliest day with a full lookback week and a full lag week behind it
        self.first_day = (self.first + pd.Timedelta(days=14)).ceil("D")
        # last day whose 24 h are all present
        d = self.last.normalize() if self.last.hour == 23 else self.last.normalize() - pd.Timedelta(days=1)
        self.last_full_day = d
        # last day a forecast can start on (history before 00:00 is complete)
        self.last_forecast_day = (self.last + pd.Timedelta(hours=1)).normalize()


class Engine:
    def __init__(self, data_path=DATA_PATH, model_dir=MODEL_DIR, carbon_path=CARBON_PATH, upload_dir=UPLOAD_DIR):
        import tensorflow as tf  # imported late so validation-only callers stay fast
        self.model = tf.keras.models.load_model(os.path.join(model_dir, "aura_lstm.keras"))
        self.bundle = joblib.load(os.path.join(model_dir, "scaler.joblib"))
        with open(os.path.join(model_dir, "metrics.json")) as f:
            self.metrics = json.load(f)
        self.upload_dir = upload_dir
        self.carbon_path = carbon_path
        raw = pd.read_csv(data_path, parse_dates=["timestamp"], index_col="timestamp")
        hourly = raw["total_kw"].resample("1h").mean()
        self.cubems = Dataset(CUBEMS, hourly, raw, "CU-BEMS Chulalongkorn University building")
        train_end = pd.Timestamp(self.metrics["periods"]["train"][1])
        train = hourly[hourly.index <= train_end].dropna()
        self.ref_kw = float(train.max())                  # sizes the fleet: peak training load fills every node
        self.ref_lo, self.ref_hi = float(train.quantile(0.01)), float(train.quantile(0.99))
        self.hour_temp = raw["temp_c"].groupby(raw.index.hour).mean()
        profile = train.groupby([train.index.dayofweek >= 5, train.index.hour]).mean()
        self.weekday_profile = profile.loc[False].to_numpy()
        self.weekend_ratio = float(profile.loc[True].mean() / profile.loc[False].mean())
        self.usual_mae = self.metrics["test"]["lstm"]["mae_kw"]
        self._carbon = None
        self._fc_cache = {}
        self._datasets = {CUBEMS: self.cubems}

    # ---- datasets ----------------------------------------------------------------------------------------------------
    def dataset(self, ident, field="dataset"):
        ident = CUBEMS if ident in (None, "") else ident
        if not isinstance(ident, str):
            raise ValidationError("dataset must be a string", field)
        if ident in self._datasets:
            return self._datasets[ident]
        path = os.path.join(self.upload_dir, f"{ident}.csv") if re.fullmatch(r"[0-9a-f]{12}", ident) else None
        if not path or not os.path.exists(path):
            raise ValidationError(f"unknown dataset '{ident}'; use 'cubems' or the id returned by /api/upload", field)
        raw = pd.read_csv(path, parse_dates=["timestamp"], index_col="timestamp")
        ds = Dataset(ident, raw["total_kw"], raw, f"uploaded series {ident}")
        self._datasets[ident] = ds
        return ds

    def _forecast(self, ds, day):
        key = (ds.id, day)
        if key not in self._fc_cache:
            if len(self._fc_cache) > 4000:
                self._fc_cache.clear()
            self._fc_cache[key] = forecast(ds.raw, self.model, self.bundle, day)
        return self._fc_cache[key]

    def _carbon_series(self, grid, index):
        """Hourly gCO2/kWh for `index` (local timestamps) under the chosen grid."""
        if isinstance(grid, list):
            return pd.Series([grid[t.hour] for t in index], index=index, dtype=float), "custom hourly profile"
        if grid in FLAT:
            return pd.Series(FLAT[grid], index=index, dtype=float), grid
        if grid == "uk-2019":
            if self._carbon is None:
                ci = pd.read_csv(self.carbon_path, parse_dates=["ts"]).set_index("ts")["gco2_per_kwh"]
                ci.index = ci.index.tz_convert(ASSUMPTIONS["building_timezone"]).tz_localize(None)
                self._carbon = ci
            aligned = self._carbon.reindex(index).interpolate(limit=3, limit_direction="both")
            if aligned.isna().any():
                raise ValidationError(
                    f"carbonGrid 'uk-2019' covers {self._carbon.index[0]:%Y-%m-%d} to {self._carbon.index[-1]:%Y-%m-%d}; "
                    "pick dates inside that period or another carbonGrid", "carbonGrid")
            return aligned, "uk-2019"
        curve = GRID_CURVES[grid]
        return pd.Series([curve[t.hour] for t in index], index=index, dtype=float), f"{grid} grid profile"

    # ---- validation --------------------------------------------------------------------------------------------------
    def validate_simulate(self, params):
        if not isinstance(params, dict):
            raise ValidationError("request body must be a JSON object")
        ds = self.dataset(params.get("dataset"))
        if params.get("startDate") is None:
            start = max(ds.first_day, pd.Timestamp(self.metrics["periods"]["test"][0]).ceil("D")) if ds.id == CUBEMS                 else ds.first_day
        else:
            start = _date(params["startDate"], "startDate")
        if params.get("endDate") is None:
            end = min(start + pd.Timedelta(days=6), ds.last_full_day) if ds.id == CUBEMS else ds.last_full_day
        else:
            end = _date(params["endDate"], "endDate")
        if end < start:
            raise ValidationError("endDate must not be before startDate", "endDate")
        if (end - start).days + 1 > MAX_DAYS:
            raise ValidationError(f"the period is limited to {MAX_DAYS} days", "endDate")
        if start < ds.first_day:
            raise ValidationError(f"startDate must be on or after {ds.first_day:%Y-%m-%d} "
                                  f"(the model needs two weeks of history); {ds.label} starts {ds.first:%Y-%m-%d}", "startDate")
        if end > ds.last_full_day:
            raise ValidationError(f"endDate must be on or before {ds.last_full_day:%Y-%m-%d}, the last complete day of {ds.label}",
                                  "endDate")
        servers = _num(params, "servers", 50, 1, 1000, integer=True)
        idle = _num(params, "idleWatts", 100, 10, 500)
        if isinstance(params.get("peakWatts"), (int, float)) and not isinstance(params.get("peakWatts"), bool)                 and params["peakWatts"] <= idle:
            raise ValidationError(f"peakWatts must be greater than idleWatts ({idle:g})", "peakWatts")
        peak = _num(params, "peakWatts", max(250, idle + 1), idle + 1, 1500)
        share = _num(params, "deferrableShare", 0.3, 0, 1)
        headroom = _num(params, "headroom", ASSUMPTIONS["headroom"], 0, 2)
        pue = _num(params, "pue", ASSUMPTIONS["pue"], 1, 3)
        price = _num(params, "pricePerKwh", ASSUMPTIONS["price_usd_per_kwh"], 0, 10)
        shift = params.get("carbonShift", True)
        if not isinstance(shift, bool):
            raise ValidationError("carbonShift must be true or false", "carbonShift")

        grid = params.get("carbonGrid", "medium")
        if isinstance(grid, list):
            if len(grid) != 24 or any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) or x < 0
                                      for x in grid):
                raise ValidationError("a custom carbonGrid needs 24 non-negative hourly gCO2/kWh numbers", "carbonGrid")
        elif not isinstance(grid, str) or grid not in CARBON_GRIDS:
            raise ValidationError(f"carbonGrid must be one of {', '.join(CARBON_GRIDS)}", "carbonGrid")

        events = params.get("events", [])
        if not isinstance(events, list) or any(not isinstance(x, str) for x in events):
            raise ValidationError("events must be a list of strings", "events")
        bad = [x for x in events if x not in EVENTS]
        if bad:
            raise ValidationError(f"unknown event '{bad[0]}'; use any of {', '.join(EVENTS)}", "events")
        events = list(dict.fromkeys(events))

        return dict(ds=ds, start=start, end=end, servers=servers, idle=idle, peak=peak, share=share, headroom=headroom,
                    pue=pue, price=price, shift=shift, grid=grid, events=events)

    # ---- operations --------------------------------------------------------------------------------------------------
    def simulate(self, params):
        t0 = time.time()
        p = self.validate_simulate(params)
        ds, warnings = p["ds"], []
        # scale the small-fleet knobs with the fleet so 48 servers reproduces the published setup
        n = p["servers"]
        scale = max(1, round(n * ASSUMPTIONS["nodes_min"] / ASSUMPTIONS["nodes_total"]))
        a = dict(ASSUMPTIONS, nodes_total=n, nodes_min=min(scale, n), buffer_nodes=scale,
                 node_idle_kw=p["idle"] / 1000, node_peak_kw=p["peak"] / 1000, batch_share=p["share"],
                 headroom=p["headroom"], pue=p["pue"], price_usd_per_kwh=p["price"])
        days = pd.date_range(p["start"], p["end"], freq="D")
        index = pd.date_range(p["start"], p["end"] + pd.Timedelta(days=1), freq="1h", inclusive="left")
        carbon, carbon_source = self._carbon_series(p["grid"], index)

        def factor(known_only):
            evs = [EVENTS[k] for k in p["events"] if EVENTS[k]["known"] or not known_only]

            def f(idx):
                out = np.ones(len(idx))
                for ev in evs:
                    m = np.isin(idx.hour, list(ev["hours"]))
                    if ev["weekdays_only"]:
                        m &= idx.dayofweek < 5
                    out = np.where(m, out * ev["factor"], out)
                return out
            return f if evs else None

        res = replay(days, ds.hourly, lambda day: self._forecast(ds, day), carbon, a, n / self.ref_kw,
                     self.usual_mae, shift=p["shift"], actual_factor=factor(False), forecast_factor=factor(True))
        rows = res["rows"]
        if not rows:
            raise ValidationError("no complete days with enough history in this period", "startDate")
        for day, why in res["skipped"]:
            warnings.append(f"Skipped {day:%Y-%m-%d}: {why}.")
        if p["events"]:
            warnings.append("Events apply to every day of the period: " + ", ".join(
                f"{k} (x{EVENTS[k]['factor']} demand{'' if EVENTS[k]['known'] else ', not in the forecast'})"
                for k in p["events"]) + ".")
        if p["share"] > 0 and p["shift"] and carbon.nunique() == 1:
            warnings.append("The carbon grid is flat, so shifting batch work cannot reduce carbon.")

        df = pd.DataFrame(rows)
        e, eb = df["energyKwh"].sum(), df["baselineEnergyKwh"].sum()
        c, cb = df["carbonGco2"].sum() / 1000, df["baselineCarbonGco2"].sum() / 1000
        summary = {
            "energySavedKwh": round(eb - e, 1),
            "co2SavedKg": round(cb - c, 1),
            "costSaved": round(df["baselineCost"].sum() - df["cost"].sum(), 2),
            "slaPct": round(100 * df["slaMet"].mean(), 2),
            "percentReduction": round(100 * (eb - e) / eb, 1) if eb else 0.0,
            "co2PercentReduction": round(100 * (cb - c) / cb, 1) if cb else 0.0,
            "slaMissHours": int((~df["slaMet"]).sum()),
            "energyKwh": round(e, 1), "baselineKwh": round(eb, 1),
            "co2Kg": round(c, 1), "baselineCo2Kg": round(cb, 1),
            "avgServersOn": round(df["activeNodes"].mean(), 1),
            "peakServersOn": int(df["activeNodes"].max()),
            "batchBacklogEndNodeHours": round(res["backlog"], 2),
            "carbonSource": carbon_source,
            "period": {"start": p["start"].strftime("%Y-%m-%d"), "end": p["end"].strftime("%Y-%m-%d"),
                       "hours": len(rows), "days": len(rows) // 24},
        }
        peak_kw = a["node_peak_kw"]
        k = n / self.ref_kw * peak_kw  # building kW -> server-pool demand at full utilisation
        hourly = [{
            "ts": r["timestamp"] + "Z", "demandKw": round(r["actualDemandKw"] * k, 2),
            "forecastKw": round(r["forecastDemandKw"] * k, 2),
            "serversOn": r["activeNodes"], "plannedServers": r["plannedNodes"],
            "energyKwh": r["energyKwh"], "baselineKwh": r["baselineEnergyKwh"],
            "co2G": r["carbonGco2"], "baselineCo2G": r["baselineCarbonGco2"],
            "carbonIntensity": r["carbonIntensity"], "utilizationPct": r["utilization"],
            "batchNodeHours": r["batchNodeHours"], "slaMet": r["slaMet"],
        } for r in rows]
        df["date"] = df["timestamp"].str[:10]
        daily = [{"date": d, "energyKwh": round(g["energyKwh"].sum(), 1), "baselineKwh": round(g["baselineEnergyKwh"].sum(), 1),
                  "co2Kg": round(g["carbonGco2"].sum() / 1000, 1),
                  "baselineCo2Kg": round(g["baselineCarbonGco2"].sum() / 1000, 1),
                  "slaPct": round(100 * g["slaMet"].mean(), 1)} for d, g in df.groupby("date")]
        alerts = [dict(x, timestamp=x["timestamp"] + "Z")
                  for x in sorted(res["alerts"], key=lambda x: x["timestamp"], reverse=True)]
        return {
            "hourly": hourly,
            "summary": summary,
            "recommendations": self._recommend(df, p, n, summary),
            "daily": daily,
            "alerts": alerts,
            "params": {"dataset": ds.id, "startDate": p["start"].strftime("%Y-%m-%d"),
                       "endDate": p["end"].strftime("%Y-%m-%d"),
                       "servers": n, "idleWatts": p["idle"], "peakWatts": p["peak"], "deferrableShare": p["share"],
                       "carbonGrid": p["grid"], "events": p["events"], "headroom": p["headroom"], "pue": p["pue"],
                       "pricePerKwh": p["price"], "carbonShift": p["shift"]},
            "model": self._model_info(),
            "warnings": warnings,
            "elapsedMs": round((time.time() - t0) * 1000),
        }

    def _recommend(self, df, p, n, s):
        """Plain-language advice derived from the simulated hours (0-8 sentences)."""
        out = []
        ci = df.assign(h=pd.to_datetime(df["timestamp"]).dt.hour).groupby("h")["carbonIntensity"].mean()
        if p["share"] > 0 and ci.max() - ci.min() > 30:
            smooth = pd.Series([ci.iloc[[(h - 1) % 24, h, (h + 1) % 24]].mean() for h in range(24)])
            w = int(smooth.idxmin())
            out.append(f"Shift batch jobs to {(w - 1) % 24:02d}:00-{(w + 2) % 24:02d}:00 when the grid is cleanest "
                       f"(about {smooth.min():.0f} gCO2/kWh vs {ci.max():.0f} at the dirtiest hour).")
        elif p["share"] > 0:
            out.append("Grid carbon intensity barely varies through the day, so timing batch jobs will not cut emissions; "
                       "savings come from switching idle servers off.")
        if p["share"] < 0.1:
            out.append("Little of the load can be deferred; making more jobs (backups, research runs) deferrable "
                       "raises carbon savings.")
        if s["slaPct"] < 95:
            out.append(f"SLA compliance is {s['slaPct']:.1f}%, below the 95% target: raise the headroom or keep more "
                       "servers on during unexpected demand peaks.")
        elif s["slaPct"] >= 99.5 and s["percentReduction"] < 25:
            out.append("SLA is almost never missed, so there is room to run leaner and save more energy.")
        if s["peakServersOn"] >= n:
            out.append(f"All {n} servers were needed at the busiest hour; add capacity if demand keeps growing.")
        elif s["peakServersOn"] <= 0.5 * n:
            out.append(f"At most {s['peakServersOn']} of {n} servers were ever needed; the pool is larger than the "
                       "demand requires.")
        if "event" in p["events"]:
            out.append("The unplanned event is not in the forecast, so AURA reacts only after demand rises; "
                       "plan capacity ahead of known events.")
        if "exam" in p["events"]:
            out.append("Exam periods raise weekday daytime demand; AURA scales up ahead of them using the forecast.")
        if p["idle"] / p["peak"] > 0.6:
            out.append("Idle power is over 60% of peak, so switching servers off saves far more than raising utilisation.")
        return out[:8]

    def preview(self, date, dataset=None):
        ds = self.dataset(dataset)
        day = _date(date, "date")
        if day < ds.first_day or day > ds.last_forecast_day:
            raise ValidationError(f"date must be between {ds.first_day:%Y-%m-%d} and {ds.last_forecast_day:%Y-%m-%d} "
                                  f"for {ds.label}", "date")
        try:
            fc = self._forecast(ds, day)
        except ValueError as exc:
            raise ValidationError(f"cannot forecast {date}: {exc}", "date") from None
        actual = ds.hourly.reindex(pd.date_range(day, periods=24, freq="1h"))
        hours = []
        for r in fc["forecast"]:
            a = actual.get(pd.Timestamp(r["timestamp"]))
            hours.append({"ts": r["timestamp"] + "Z", "forecastKw": r["total_kw"],
                          "actualKw": None if a is None or pd.isna(a) else round(float(a), 2),
                          "sameHourLastWeekKw": r["same_hour_last_week_kw"], "isHoliday": r["is_holiday"]})
        pairs = [(h["forecastKw"], h["actualKw"]) for h in hours if h["actualKw"] is not None]
        out = {"date": f"{day:%Y-%m-%d}", "dataset": ds.id, "hourly": hours, "summary": dict(fc["summary"]),
               "actualSource": "CU-BEMS metered load" if ds.id == CUBEMS else "uploaded series (rescaled)",
               "model": self._model_info(), "warnings": []}
        out["summary"].pop("mae_vs_actual_kw", None)
        if pairs:
            out["summary"]["maeKw"] = round(float(np.mean([abs(f - a) for f, a in pairs])), 2)
            out["summary"]["actualHours"] = len(pairs)
            out["summary"]["actualPeakKw"] = max(a for _, a in pairs)
        else:
            out["warnings"].append("No measured reading exists for this date; showing the forecast only.")
        if len(pairs) < 24 and pairs:
            out["warnings"].append(f"Measured readings exist for {len(pairs)} of 24 hours.")
        return out

    def upload(self, csv_text, name=None):
        warnings = []
        if not isinstance(csv_text, str) or not csv_text.strip():
            raise ValidationError("the CSV is empty", "csv", "csv")
        try:
            df = pd.read_csv(io.StringIO(csv_text), skipinitialspace=True)
        except Exception as exc:  # pandas raises several parser types
            raise ValidationError(f"could not parse the CSV: {exc}", "csv", "csv") from None
        df.columns = [str(c).strip().lower() for c in df.columns]
        kw_col = next((c for c in ("kw", "total_kw", "power_kw") if c in df.columns), None)
        if "timestamp" not in df.columns or kw_col is None:
            raise ValidationError("the CSV needs the header 'timestamp,kw' "
                                  f"(found: {', '.join(df.columns) or 'none'})", "csv", "csv")
        if len(df) > MAX_UPLOAD_ROWS:
            raise ValidationError(f"the CSV has {len(df)} rows; the limit is {MAX_UPLOAD_ROWS}", "csv", "too_large")
        ts = pd.to_datetime(df["timestamp"], errors="coerce", utc=False, format="mixed")
        kw = pd.to_numeric(df[kw_col], errors="coerce")
        bad = int((ts.isna() | kw.isna()).sum())
        if bad > 0.05 * len(df):
            raise ValidationError(f"{bad} of {len(df)} rows have an unreadable timestamp or kw value", "csv", "csv")
        if bad:
            warnings.append(f"Dropped {bad} rows with an unreadable timestamp or kw value.")
        s = pd.Series(kw.to_numpy(), index=ts)[~(ts.isna() | kw.isna()).to_numpy()]
        if getattr(s.index, "tz", None) is not None:
            s.index = s.index.tz_convert(ASSUMPTIONS["building_timezone"]).tz_localize(None)
            warnings.append(f"Timestamps carried a time zone; converted to {ASSUMPTIONS['building_timezone']} local time.")
        if not s.index.is_monotonic_increasing:
            s = s.sort_index()
            warnings.append("Rows were not in time order; sorted them.")
        if s.index.has_duplicates:
            warnings.append(f"{int(s.index.duplicated().sum())} duplicate timestamps; averaged them.")
        if not np.isfinite(s.to_numpy()).all():
            raise ValidationError("kw contains infinite values", "csv", "csv")
        if (s < 0).any():
            warnings.append(f"{int((s < 0).sum())} negative kw values (export/generation?); clipped to 0.")
            s = s.clip(lower=0)
        if len(s) < 2:
            raise ValidationError("the CSV needs at least two readings", "csv", "csv")
        step = s.index.to_series().diff().median()
        hourly = s.groupby(level=0).mean().resample("1h").mean()
        valid = hourly.dropna()
        span_days = (valid.index[-1] - valid.index[0]).days + 1
        if span_days > MAX_DAYS:
            raise ValidationError(f"the series covers {span_days} days; the limit is {MAX_DAYS}", "csv", "too_large")
        if span_days < MIN_UPLOAD_DAYS:
            raise ValidationError(f"the series covers {span_days} days; the model needs at least {MIN_UPLOAD_DAYS} "
                                  "(a lookback week, a lag week and a day to forecast)", "csv", "csv")
        if step > pd.Timedelta(hours=1):
            warnings.append(f"Readings are every {step}; the model works hourly, so gaps were interpolated (up to 3 h).")
        coverage = len(valid) / (span_days * 24)
        if coverage < 0.9:
            warnings.append(f"Only {coverage:.0%} of hours have a reading; days with gaps cannot be simulated.")
        hourly = hourly.interpolate(limit=3, limit_area="inside")

        lo, hi = float(valid.quantile(0.01)), float(valid.quantile(0.99))
        if hi - lo < 1e-9:
            raise ValidationError("the series is constant, so there is no demand pattern to forecast", "csv", "csv")
        gain = (self.ref_hi - self.ref_lo) / (hi - lo)
        scaled = (self.ref_lo + (hourly - lo) * gain).clip(lower=0)
        warnings.append(f"Rescaled to the model's range: 1st-99th percentile {lo:.3g}-{hi:.3g} kW mapped to "
                        f"{self.ref_lo:.0f}-{self.ref_hi:.0f} kW (x{gain:.3g}).")

        # does it look like an academic building load?
        prof = valid.groupby([valid.index.dayofweek >= 5, valid.index.hour]).mean()
        corr = None
        if False in prof.index.get_level_values(0) and len(prof.loc[False]) == 24:
            corr = float(np.corrcoef(prof.loc[False].to_numpy(), self.weekday_profile)[0, 1])
            if corr < 0.5:
                warnings.append(f"The weekday daily shape differs from CU-BEMS (correlation {corr:.2f}); "
                                "forecasts may be less accurate than the published test error.")
        ratio = None
        if True in prof.index.get_level_values(0) and False in prof.index.get_level_values(0):
            ratio = float(prof.loc[True].mean() / prof.loc[False].mean())
            if abs(ratio - self.weekend_ratio) > 0.25:
                warnings.append(f"Weekend load is {ratio:.0%} of weekday load; CU-BEMS shows {self.weekend_ratio:.0%}.")
        if span_days < 60:
            warnings.append("Under 60 days of history: holidays and term cycles are hard to judge from so little data.")
        warnings.append("No temperature column; used CU-BEMS' average temperature for each hour of day.")

        raw = pd.DataFrame({"total_kw": scaled})
        raw["temp_c"] = self.hour_temp.reindex(raw.index.hour).to_numpy()
        ident = hashlib.sha1(raw.to_csv().encode()).hexdigest()[:12]
        os.makedirs(self.upload_dir, exist_ok=True)
        raw.rename_axis("timestamp").to_csv(os.path.join(self.upload_dir, f"{ident}.csv"))
        self._datasets.pop(ident, None)
        ds = self.dataset(ident)
        return {
            "uploadId": ident, "name": name, "rows": int(len(df)), "hours": int(len(valid)),
            "start": f"{ds.first:%Y-%m-%d %H:%M}", "end": f"{ds.last:%Y-%m-%d %H:%M}",
            "simulateFrom": f"{ds.first_day:%Y-%m-%d}", "simulateTo": f"{ds.last_full_day:%Y-%m-%d}",
            "scale": {"gain": round(gain, 6), "originalP01": round(lo, 4), "originalP99": round(hi, 4),
                      "targetP01": round(self.ref_lo, 1), "targetP99": round(self.ref_hi, 1)},
            "similarity": {"weekdayProfileCorrelation": None if corr is None else round(corr, 3),
                           "weekendToWeekdayRatio": None if ratio is None else round(ratio, 3),
                           "coverage": round(coverage, 3)},
            "warnings": warnings,
        }

    def upload_and_simulate(self, csv_text, name, params):
        """Register the series, then simulate every complete day the model can forecast from it."""
        params = dict(params or {})
        params.pop("dataset", None)
        up = self.upload(csv_text, name)
        params.setdefault("startDate", up["simulateFrom"])
        params.setdefault("endDate", up["simulateTo"])
        sim = self.simulate(dict(params, dataset=up["uploadId"]))
        sim["warnings"] = up["warnings"] + sim["warnings"]
        sim["upload"] = {k: v for k, v in up.items() if k != "warnings"}
        return sim

    def _model_info(self):
        t = self.metrics["test"]
        return {"name": "AURA LSTM (encoder-decoder, 7-day lookback, 24 h horizon)",
                "testMaeKw": round(t["lstm"]["mae_kw"], 2), "testMapePct": round(t["lstm"]["mape_pct"], 1),
                "seasonalNaiveMaeKw": round(t["seasonal_naive_week"]["mae_kw"], 2)}

    def info(self):
        c = self.cubems
        return {"datasets": {CUBEMS: {"start": f"{c.first:%Y-%m-%d}", "end": f"{c.last:%Y-%m-%d %H:%M}",
                                      "simulateFrom": f"{c.first_day:%Y-%m-%d}", "simulateTo": f"{c.last_full_day:%Y-%m-%d}",
                                      "previewTo": f"{c.last_forecast_day:%Y-%m-%d}"}},
                "carbonGrids": CARBON_GRIDS, "defaults": {"servers": 48, "idleWatts": 120, "peakWatts": 300,
                                                          "deferrableShare": 0.2, "carbonGrid": "auto"},
                "limits": {"maxDays": MAX_DAYS, "maxEvents": MAX_EVENTS, "maxUploadRows": MAX_UPLOAD_ROWS},
                "model": self._model_info()}
