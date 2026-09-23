"""
AURA — Data Preprocessing Pipeline
====================================
Handles dataset acquisition, resampling, cleaning, synthetic academic-calendar
augmentation, normalisation, and chronological train/val/test splitting.

Data source: Azure Public Dataset V2 — VM CPU utilisation traces
  • Full dataset: 235 GB (impractical for a course project)
  • Strategy: download a representative ~50 K-row subset from the public blob,
    OR generate a synthetic baseline with Azure-like statistical properties if
    the download is unavailable.

Output (written to dataset/processed/):
  train.csv, val.csv, test.csv   — split CSVs with columns [timestamp, utilization]
  scaler.pkl                     — fitted MinMaxScaler for inverse-transform

Run:
  python src/ml_model/preprocessing/preprocess.py

All steps are idempotent — re-running overwrites processed/ safely.
"""

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

# ── Paths ─────────────────────────────────────────────────────────────────────

ROOT = Path(__file__).resolve().parents[3]          # repo root
RAW_DIR = ROOT / "dataset" / "raw"
PROCESSED_DIR = ROOT / "dataset" / "processed"
PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

ML_DIR = Path(__file__).resolve().parents[1]        # src/ml_model/

# ── Constants ─────────────────────────────────────────────────────────────────

RESAMPLE_FREQ = "5min"      # 5-minute intervals (288 per day)
TRAIN_RATIO = 0.70
VAL_RATIO   = 0.15
# Test ratio is implicit: 1 - TRAIN - VAL = 0.15

RANDOM_SEED = 42
random.seed(RANDOM_SEED)
np.random.seed(RANDOM_SEED)

# Azure dataset public blob URL — small sample CSV (≈ 50 MB, 1000 VMs × 50 readings each)
# Source: https://github.com/Azure/AzurePublicDataset
AZURE_SAMPLE_URL = (
    "https://azurecloudpublicdataset.blob.core.windows.net/"
    "azurepublicdataset/2019/AzurePublicDatasetLinksV2.txt"
)

# ── Academic Calendar Multipliers ─────────────────────────────────────────────
# NOTE: These multipliers are SYNTHETIC — designed to simulate university
# demand patterns. They are NOT derived from real academic data.
# See dataset/dataset_description.md for full disclosure.

def academic_multiplier(dt: datetime) -> float:
    """
    Return a demand multiplier for timestamp `dt` based on synthetic
    academic-calendar patterns.

    Multipliers (synthetic, not empirical):
      Exam weeks        → 1.4×   (Nov & Apr end-semester exams)
      Semester start    → 1.3×   (first 2 weeks of Aug & Feb)
      Lecture hours     → 1.15×  (09:00–17:00 weekdays)
      Weekends          → 0.70×
      Semester break    → 0.50×  (Dec–Jan, May–Jun)
      Off-peak night    → 0.85×  (22:00–06:00 weekdays outside exam)
    """
    month   = dt.month
    hour    = dt.hour
    weekday = dt.weekday()   # 0 = Monday, 6 = Sunday
    day     = dt.day

    # Semester break (winter + summer)
    if month in (12, 1, 5, 6):
        return 0.5

    # Exam weeks
    if month in (11, 4):
        return 1.4

    # Semester start (first two weeks)
    if month in (8, 2) and day <= 14:
        return 1.3

    # Weekends
    if weekday >= 5:
        return 0.7

    # Lecture hours: 9 AM – 5 PM weekdays
    if 9 <= hour < 17:
        return 1.15

    # Off-peak night: 10 PM – 6 AM weekdays
    if hour >= 22 or hour < 6:
        return 0.85

    return 1.0   # evening hours — normal load


# ── Dataset Acquisition ───────────────────────────────────────────────────────

def _find_existing_raw_csv() -> Path | None:
    """Return the first CSV found in dataset/raw/, or None."""
    csvs = list(RAW_DIR.glob("*.csv"))
    if csvs:
        print(f"  ✅ Found existing raw CSV: {csvs[0].name}")
        return csvs[0]
    return None


def _generate_synthetic_azure_like(n_rows: int = 75_000) -> pd.DataFrame:
    """
    Generate a synthetic dataset with statistical properties matching the
    Azure Public Dataset V2 VM CPU traces.

    Properties based on published summary stats from the Azure paper
    (Cortez et al., 2017 — Azure Traces for Resource Management Research):
      • Mean CPU utilisation ≈ 26 %
      • Std ≈ 18 %
      • Bimodal: bursty peaks (compute VMs) + low-baseline (idle VMs)
      • Strong daily and weekly seasonality

    The series covers ~18 months to give the model sufficient academic-calendar
    cycles to learn from.
    """
    print("  ⚠️  No raw dataset found. Generating synthetic Azure-like traces ...")
    print(f"     Generating {n_rows:,} rows (≈ {n_rows // 288} days) ...")

    # Start from 2025-01-01 to cover at least one full academic year
    start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    timestamps = [start + timedelta(minutes=5 * i) for i in range(n_rows)]

    util_values = []
    rng = np.random.default_rng(RANDOM_SEED)

    for ts in timestamps:
        mult = academic_multiplier(ts)

        # Daily sinusoidal pattern: peak at 14:00, trough at 04:00
        hour_frac = ts.hour + ts.minute / 60
        daily_osc = 0.5 + 0.3 * math.sin(2 * math.pi * (hour_frac - 4) / 24)

        # Base load: bimodal mix of low-idle VMs and active VMs
        if rng.random() < 0.35:
            # Low-baseline VM cluster (idle): ~5–15 %
            base = rng.normal(10, 4)
        else:
            # Active VM cluster: ~20–60 %
            base = rng.normal(35, 15) * daily_osc

        # Apply academic multiplier
        util = base * mult

        # Add measurement noise
        util += rng.normal(0, 1.5)

        util_values.append(float(np.clip(util, 1.0, 100.0)))

    df = pd.DataFrame({"timestamp": timestamps, "utilization": util_values})
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    return df


def load_raw_data() -> pd.DataFrame:
    """
    Load raw utilisation data. Priority:
      1. Existing CSV in dataset/raw/
      2. Synthetic Azure-like generation (fallback)

    Returns a DataFrame with columns: [timestamp (UTC, DatetimeTZDtype), utilization (float)]
    """
    existing = _find_existing_raw_csv()

    if existing:
        df = pd.read_csv(existing)

        # Normalise column names — Azure dataset uses various formats
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

    # Fallback: generate synthetic data
    return _generate_synthetic_azure_like(n_rows=75_000)


# ── Preprocessing Steps ───────────────────────────────────────────────────────

def resample_and_clean(df: pd.DataFrame) -> pd.DataFrame:
    """
    1. Set timestamp as index.
    2. Resample to 5-min intervals (mean aggregation).
    3. Forward-fill gaps (≤6 steps = 30 min), then linear interpolation.
    4. Clip utilisation to [0, 100].
    """
    print("  → Resampling to 5-min intervals ...")
    df = df.set_index("timestamp").sort_index()
    df = df.resample(RESAMPLE_FREQ).mean()

    # Forward-fill short gaps (sensor dropout), then interpolate longer gaps
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
    """
    Apply synthetic academic-calendar demand multipliers.
    NOTE: The multipliers are synthetic — see dataset/dataset_description.md.
    """
    print("  → Applying synthetic academic-calendar multipliers ...")
    df = df.copy()

    # Ensure timezone-aware datetimes
    if df["timestamp"].dt.tz is None:
        df["timestamp"] = df["timestamp"].dt.tz_localize("UTC")

    multipliers = df["timestamp"].apply(lambda ts: academic_multiplier(ts.to_pydatetime()))
    df["utilization"] = (df["utilization"] * multipliers).clip(0.0, 100.0)
    df["academic_multiplier"] = multipliers   # keep for reference
    return df


def normalise(df: pd.DataFrame) -> tuple[pd.DataFrame, MinMaxScaler]:
    """
    Fit a MinMaxScaler on the utilization column (range [0, 1]).
    Returns (normalised_df, fitted_scaler).
    """
    print("  → Normalising utilization to [0, 1] ...")
    scaler = MinMaxScaler(feature_range=(0, 1))
    df = df.copy()
    df["utilization_norm"] = scaler.fit_transform(df[["utilization"]])
    return df, scaler


def chronological_split(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """
    Split df chronologically (NO shuffling):
      70 % train | 15 % val | 15 % test
    """
    n = len(df)
    train_end = int(n * TRAIN_RATIO)
    val_end   = int(n * (TRAIN_RATIO + VAL_RATIO))

    train = df.iloc[:train_end].copy()
    val   = df.iloc[train_end:val_end].copy()
    test  = df.iloc[val_end:].copy()

    print(f"  → Split: train={len(train):,}  val={len(val):,}  test={len(test):,}")
    return train, val, test


# ── Save Outputs ──────────────────────────────────────────────────────────────

def save_outputs(
    train: pd.DataFrame,
    val: pd.DataFrame,
    test: pd.DataFrame,
    scaler: MinMaxScaler,
) -> None:
    """Write split CSVs and scaler to dataset/processed/ and src/ml_model/."""
    for split, name in [(train, "train"), (val, "val"), (test, "test")]:
        path = PROCESSED_DIR / f"{name}.csv"
        split.to_csv(path, index=False)
        print(f"  ✅ Saved {path.relative_to(ROOT)}")

    scaler_path = ML_DIR / "scaler.pkl"
    with open(scaler_path, "wb") as f:
        pickle.dump(scaler, f)
    print(f"  ✅ Saved scaler → {scaler_path.relative_to(ROOT)}")


# ── Main ──────────────────────────────────────────────────────────────────────

def run_pipeline() -> None:
    print("\n🔧 AURA Preprocessing Pipeline")
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

    print("\n✅ Preprocessing complete!")
    print(f"   Total rows: {len(df):,}")
    print(f"   Date range: {df['timestamp'].min()} → {df['timestamp'].max()}")
    print(f"   Utilisation stats (raw):")
    print(f"     mean={df['utilization'].mean():.1f}%  "
          f"std={df['utilization'].std():.1f}%  "
          f"min={df['utilization'].min():.1f}%  "
          f"max={df['utilization'].max():.1f}%\n")


if __name__ == "__main__":
    run_pipeline()
