from __future__ import annotations

import io
import math
import os
import pickle
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import requests
from sklearn.preprocessing import MinMaxScaler

ROOT = Path(__file__).resolve().parents[3]
RAW_DIR = ROOT / "dataset" / "raw"
PROCESSED_DIR = ROOT / "dataset" / "processed"
PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

ML_DIR = Path(__file__).resolve().parents[1]

RESAMPLE_FREQ = "5min"
TRAIN_RATIO = 0.70
VAL_RATIO   = 0.15

RANDOM_SEED = 42
random.seed(RANDOM_SEED)
np.random.seed(RANDOM_SEED)


def academic_multiplier(dt: datetime) -> float:
    month   = dt.month
    hour    = dt.hour
    weekday = dt.weekday()
    day     = dt.day

    if month in (12, 1, 5, 6):
        return 0.5
    if month in (11, 4):
        return 1.4
    if month in (8, 2) and day <= 14:
        return 1.3
    if weekday >= 5:
        return 0.7
    if 9 <= hour < 17:
        return 1.15
    if hour >= 22 or hour < 6:
        return 0.85
    return 1.0


def _find_existing_raw_csv() -> Path | None:
    csvs = list(RAW_DIR.glob("*.csv"))
    if csvs:
        print(f"  Found existing raw CSV: {csvs[0].name}")
        return csvs[0]
    return None


def _generate_synthetic_azure_like(n_rows: int = 75_000) -> pd.DataFrame:
    print("  No raw dataset found. Generating synthetic Azure-like traces ...")
    print(f"     Generating {n_rows:,} rows ...")

    start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    timestamps = [start + timedelta(minutes=5 * i) for i in range(n_rows)]

    util_values = []
    rng = np.random.default_rng(RANDOM_SEED)

    for ts in timestamps:
        mult = academic_multiplier(ts)
        hour_frac = ts.hour + ts.minute / 60
        daily_osc = 0.5 + 0.3 * math.sin(2 * math.pi * (hour_frac - 4) / 24)

        if rng.random() < 0.35:
            base = rng.normal(10, 4)
        else:
            base = rng.normal(35, 15) * daily_osc

        util = base * mult
        util += rng.normal(0, 1.5)
        util_values.append(float(np.clip(util, 1.0, 100.0)))

    df = pd.DataFrame({"timestamp": timestamps, "utilization": util_values})
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    return df


def load_raw_data() -> pd.DataFrame:
    existing = _find_existing_raw_csv()

    if existing:
        df = pd.read_csv(existing)
        col_map = {}
        for c in df.columns:
            low = c.lower().replace(" ", "_")
            if "time" in low or "date" in low:
                col_map[c] = "timestamp"
            elif "cpu" in low or "util" in low or "usage" in low:
                col_map[c] = "utilization"
        df = df.rename(columns=col_map)

        if "timestamp" not in df.columns or "utilization" not in df.columns:
            raise ValueError(
                f"Cannot find timestamp/utilization columns in {existing.name}. "
                f"Found: {list(df.columns)}"
            )

        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
        df["utilization"] = pd.to_numeric(df["utilization"], errors="coerce")
        df = df.dropna(subset=["timestamp", "utilization"])
        return df[["timestamp", "utilization"]].copy()

    return _generate_synthetic_azure_like(n_rows=75_000)


def resample_and_clean(df: pd.DataFrame) -> pd.DataFrame:
    print("  Resampling to 5-min intervals ...")
    df = df.set_index("timestamp").sort_index()
    df = df.resample(RESAMPLE_FREQ).mean()

    df["utilization"] = (
        df["utilization"]
        .ffill(limit=6)
        .interpolate(method="time")
    )

    df["utilization"] = df["utilization"].clip(0.0, 100.0)
    df = df.dropna()
    print(f"     Shape after resample: {df.shape[0]:,} rows")
    return df.reset_index()


def apply_academic_multipliers(df: pd.DataFrame) -> pd.DataFrame:
    print("  Applying academic-calendar multipliers ...")
    df = df.copy()

    if df["timestamp"].dt.tz is None:
        df["timestamp"] = df["timestamp"].dt.tz_localize("UTC")

    multipliers = df["timestamp"].apply(lambda ts: academic_multiplier(ts.to_pydatetime()))
    df["utilization"] = (df["utilization"] * multipliers).clip(0.0, 100.0)
    df["academic_multiplier"] = multipliers
    return df


def normalise(df: pd.DataFrame) -> tuple[pd.DataFrame, MinMaxScaler]:
    print("  Normalising utilization to [0, 1] ...")
    scaler = MinMaxScaler(feature_range=(0, 1))
    df = df.copy()
    df["utilization_norm"] = scaler.fit_transform(df[["utilization"]])
    return df, scaler


def chronological_split(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    n = len(df)
    train_end = int(n * TRAIN_RATIO)
    val_end   = int(n * (TRAIN_RATIO + VAL_RATIO))

    train = df.iloc[:train_end].copy()
    val   = df.iloc[train_end:val_end].copy()
    test  = df.iloc[val_end:].copy()

    print(f"  Split: train={len(train):,}  val={len(val):,}  test={len(test):,}")
    return train, val, test


def save_outputs(
    train: pd.DataFrame,
    val: pd.DataFrame,
    test: pd.DataFrame,
    scaler: MinMaxScaler,
) -> None:
    for split, name in [(train, "train"), (val, "val"), (test, "test")]:
        path = PROCESSED_DIR / f"{name}.csv"
        split.to_csv(path, index=False)
        print(f"  Saved {path.relative_to(ROOT)}")

    scaler_path = ML_DIR / "scaler.pkl"
    with open(scaler_path, "wb") as f:
        pickle.dump(scaler, f)
    print(f"  Saved scaler -> {scaler_path.relative_to(ROOT)}")


def run_pipeline() -> None:
    print("\nAURA Preprocessing Pipeline")
    print("=" * 40)

    print("\n[1/5] Loading raw data ...")
    df = load_raw_data()
    print(f"      Loaded {len(df):,} raw rows")

    print("\n[2/5] Resampling & cleaning ...")
    df = resample_and_clean(df)

    print("\n[3/5] Applying academic-calendar multipliers ...")
    df = apply_academic_multipliers(df)

    print("\n[4/5] Normalising ...")
    df, scaler = normalise(df)

    print("\n[5/5] Splitting & saving ...")
    train, val, test = chronological_split(df)
    save_outputs(train, val, test, scaler)

    print("\nPreprocessing complete!")
    print(f"   Total rows: {len(df):,}")
    print(f"   Date range: {df['timestamp'].min()} -> {df['timestamp'].max()}")
    print(f"   Utilisation stats:")
    print(f"     mean={df['utilization'].mean():.1f}%  "
          f"std={df['utilization'].std():.1f}%  "
          f"min={df['utilization'].min():.1f}%  "
          f"max={df['utilization'].max():.1f}%\n")


if __name__ == "__main__":
    run_pipeline()
