"""
AURA preprocessing pipeline - REAL DATA VERSION.

Replaces the earlier synthetic-Azure-like generator with the real Azure
Public Dataset V2 VM CPU utilization trace (Cortez et al., SOSP 2017).

Why this differs from a naive "one long series" pipeline:
Azure's V2 trace ships as 195 time-sharded files, each covering ~3.75
contiguous real hours across the FULL VM fleet (not one VM across the
full ~30-day trace). Downloading enough shards for a single long
continuous series (needed for the original chronological-split design)
would require dozens of ~850MB files - impractical for this course
project's timeline, disk and memory budget (confirmed experimentally:
a background multi-file download was killed by the OS under memory
pressure after ~2 files).

Instead we extract a REAL VM PANEL from one shard (file 1 of 195): for
every VM with a complete 45/45-timestamp record in that shard's 3.75h
window, we keep its real (timestamp, utilization) trace. This gives
many real, independent short time series instead of one long one - a
standard "panel"/multi-series forecasting setup, and is 100% real
telemetry (no synthetic values, no interpolation across gaps).

Split strategy: chronological WITHIN each VM (first 70% of that VM's
ticks -> train, next 15% -> val, last 15% -> test). This preserves
causality per VM (a VM's test ticks are always later than its train
ticks). We deliberately do NOT split by disjoint VM identity (e.g. VM
A entirely in train, VM B entirely in test): every VM here was only
observed for one real 3.75h window, so a VM held out entirely for
test would have zero real history to build a prediction window from.
Splitting by time-within-VM instead means every VM contributes real
context to train and is evaluated on its own strictly-later real
ticks - see dataset/dataset_description.md for the full rationale.

Output: dataset/processed/{train,val,test}.csv, long format:
  vm_id, timestamp, utilization, utilization_norm
"""
from __future__ import annotations

import random
from pathlib import Path
import pickle

import numpy as np
import pandas as pd
from sklearn.preprocessing import MinMaxScaler

ROOT = Path(__file__).resolve().parents[3]
RAW_DIR = ROOT / "dataset" / "raw"
PROCESSED_DIR = ROOT / "dataset" / "processed"
PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

ML_DIR = Path(__file__).resolve().parents[1]

RAW_PANEL_CSV = RAW_DIR / "azure_real_vm_panel.csv"

TRAIN_RATIO = 0.70
VAL_RATIO = 0.15
# TEST_RATIO = 0.15 (remainder)

RANDOM_SEED = 42
random.seed(RANDOM_SEED)
np.random.seed(RANDOM_SEED)


def load_real_panel() -> pd.DataFrame:
    if not RAW_PANEL_CSV.exists():
        raise FileNotFoundError(
            f"Real Azure VM panel not found at {RAW_PANEL_CSV}.\n"
            "This is extracted from the Azure Public Dataset V2 (real telemetry) - "
            "see dataset/dataset_description.md for how it was built."
        )
    df = pd.read_csv(RAW_PANEL_CSV)
    df = df.sort_values(["vm_id", "timestamp"]).reset_index(drop=True)
    return df


def chronological_split_per_vm(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Split each VM's own real tick sequence 70/15/15, chronologically.

    A VM's val/test ticks are always strictly later in real time than its
    own train ticks - no leakage - while every VM contributes to every
    split (necessary since each VM was only observed for one real 3.75h
    window; there is no separate 'future' data for a held-out VM).
    """
    train_parts, val_parts, test_parts = [], [], []

    for vm_id, group in df.groupby("vm_id", sort=False):
        group = group.sort_values("timestamp")
        n = len(group)
        train_end = int(n * TRAIN_RATIO)
        val_end = train_end + max(1, int(n * VAL_RATIO))

        train_parts.append(group.iloc[:train_end])
        val_parts.append(group.iloc[train_end:val_end])
        test_parts.append(group.iloc[val_end:])

    train = pd.concat(train_parts, ignore_index=True)
    val = pd.concat(val_parts, ignore_index=True)
    test = pd.concat(test_parts, ignore_index=True)
    return train, val, test


def normalise(train: pd.DataFrame, val: pd.DataFrame, test: pd.DataFrame):
    """Fit MinMaxScaler on train utilization only, apply to all splits."""
    scaler = MinMaxScaler(feature_range=(0, 1))
    scaler.fit(train[["utilization"]])

    for split in (train, val, test):
        split["utilization_norm"] = scaler.transform(split[["utilization"]])

    return train, val, test, scaler


def save_outputs(train, val, test, scaler) -> None:
    for split, name in [(train, "train"), (val, "val"), (test, "test")]:
        path = PROCESSED_DIR / f"{name}.csv"
        split.to_csv(path, index=False)
        print(f"  Saved {path.relative_to(ROOT)} ({len(split):,} real rows, "
              f"{split['vm_id'].nunique():,} VMs)")

    scaler_path = ML_DIR / "scaler.pkl"
    with open(scaler_path, "wb") as f:
        pickle.dump(scaler, f)
    print(f"  Saved scaler -> {scaler_path.relative_to(ROOT)}")


def run_pipeline() -> None:
    print("\nAURA Preprocessing Pipeline (REAL Azure Public Dataset V2)")
    print("=" * 60)

    print("\n[1/4] Loading real VM panel ...")
    df = load_real_panel()
    n_vms = df["vm_id"].nunique()
    n_ticks = df.groupby("vm_id").size().iloc[0]
    print(f"      {len(df):,} real readings, {n_vms:,} VMs x {n_ticks} real 5-min ticks each")
    print(f"      Real trace window: {df['timestamp'].min()}s - {df['timestamp'].max()}s "
          f"({(df['timestamp'].max() - df['timestamp'].min()) / 3600:.2f}h)")

    print("\n[2/4] Chronological per-VM split (70/15/15) ...")
    train, val, test = chronological_split_per_vm(df)
    print(f"      train={len(train):,}  val={len(val):,}  test={len(test):,}")

    print("\n[3/4] Normalising (MinMaxScaler fit on train only) ...")
    train, val, test, scaler = normalise(train, val, test)

    print("\n[4/4] Saving outputs ...")
    save_outputs(train, val, test, scaler)

    print("\nPreprocessing complete!")
    print(f"   Total real readings used: {len(df):,}")
    print(f"   Utilisation stats (real, %): "
          f"mean={df['utilization'].mean():.2f}  std={df['utilization'].std():.2f}  "
          f"min={df['utilization'].min():.2f}  max={df['utilization'].max():.2f}\n")


if __name__ == "__main__":
    run_pipeline()
