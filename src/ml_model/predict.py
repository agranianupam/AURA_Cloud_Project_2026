"""Forecast the next horizon of whole-building power demand with the trained AURA LSTM.

Input:  a CSV with timestamp, total_kw and temp_c columns (e.g. dataset/processed/cubems_building_15min.csv,
        or live meter readings in the same shape) covering at least the last 7 days.
Output: JSON on stdout (or --out file):
  {"generated_at", "forecast_start", "freq", "unit", "horizon_steps",
   "summary": {"peak_kw", "peak_time", "min_kw", "energy_kwh", ...},
   "forecast": [{"timestamp", "total_kw", "same_hour_last_week_kw", "is_holiday", "actual_kw"?}, ...]}

Usage:  python src/ml_model/predict.py --data dataset/processed/cubems_building_15min.csv \
            [--model results/model] [--end "2019-10-01 00:00"] [--out forecast.json]
--end forecasts from that time onward using only data before it; with historical data the
actual readings are included for comparison.
"""
import argparse
import json
import os
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
import tensorflow as tf

from features import FUTURE_FEATURES, PAST_FEATURES, TARGET, build_features, scale_features, steps_per_week

def forecast(raw, model, bundle, end=None):
    freq, lookback, horizon = bundle["freq"], bundle["lookback"], bundle["horizon"]
    step = pd.Timedelta(freq)
    raw = raw.sort_index()
    actual = build_features(raw, freq)[TARGET]
    if end is None:
        end = actual.dropna().index[-1] + step
    end = pd.Timestamp(end).floor(freq)
    history = raw[raw.index < end]

    future_index = pd.date_range(end, periods=horizon, freq=freq)
    padded = pd.concat([history, pd.DataFrame(index=future_index, columns=history.columns, dtype=float)])
    df = build_features(padded, freq)
    df = df[df.index >= end - step * max(lookback, steps_per_week(freq))]

    past = df[df.index < end].tail(lookback)
    fut = df.loc[future_index]
    if len(past) < lookback or past[PAST_FEATURES].isna().any().any():
        raise ValueError(f"need {lookback} complete {freq} steps of total_kw/temp_c before {end}")
    if fut["kw_lag_week"].isna().any():
        raise ValueError("need readings from one week before the forecast window")

    scaled = scale_features(df, bundle["kw_scaler"], bundle["other_scaler"], bundle["other_columns"])
    xp = scaled.loc[past.index, PAST_FEATURES].to_numpy("float32")[None]
    xf = scaled.loc[future_index, FUTURE_FEATURES].to_numpy("float32")[None]
    pred = model.predict([xp, xf], verbose=0)[0]
    pred_kw = np.clip(bundle["kw_scaler"].inverse_transform(pred.reshape(-1, 1))[:, 0], 0, None)

    rows = []
    for t, p in zip(future_index, pred_kw):
        row = {
            "timestamp": t.isoformat(),
            "total_kw": round(float(p), 2),
            "same_hour_last_week_kw": round(float(fut.at[t, "kw_lag_week"]), 2),
            "is_holiday": bool(fut.at[t, "is_holiday"]),
        }
        if t in actual.index and pd.notna(actual.at[t]):
            row["actual_kw"] = round(float(actual.at[t]), 2)
        rows.append(row)

    hours = step / pd.Timedelta(hours=1)
    peak = int(np.argmax(pred_kw))
    summary = {
        "peak_kw": round(float(pred_kw[peak]), 2),
        "peak_time": future_index[peak].isoformat(),
        "min_kw": round(float(pred_kw.min()), 2),
        "mean_kw": round(float(pred_kw.mean()), 2),
        "energy_kwh": round(float(pred_kw.sum() * hours), 1),
    }
    if all("actual_kw" in r for r in rows):
        err = np.array([r["total_kw"] - r["actual_kw"] for r in rows])
        summary["mae_vs_actual_kw"] = round(float(np.abs(err).mean()), 2)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "forecast_start": end.isoformat(),
        "freq": freq,
        "unit": "kW",
        "horizon_steps": horizon,
        "summary": summary,
        "forecast": rows,
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--model", default="results/model", help="directory with aura_lstm.keras and scaler.joblib")
    ap.add_argument("--end", help="forecast start time; default: right after the last reading")
    ap.add_argument("--out", help="write JSON here instead of stdout")
    args = ap.parse_args()

    raw = pd.read_csv(args.data, parse_dates=["timestamp"], index_col="timestamp")
    model = tf.keras.models.load_model(os.path.join(args.model, "aura_lstm.keras"))
    bundle = joblib.load(os.path.join(args.model, "scaler.joblib"))
    result = forecast(raw, model, bundle, args.end)

    text = json.dumps(result, indent=2)
    if args.out:
        with open(args.out, "w") as f:
            f.write(text + "\n")
    else:
        print(text)

if __name__ == "__main__":
    main()
