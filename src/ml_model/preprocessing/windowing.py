"""
VM-aware sliding-window builder for the real Azure VM panel.

Critical: windows must never cross a VM boundary. The processed CSVs
(dataset/processed/{train,val,test}.csv) are long-format, many VMs
concatenated one after another - naively sliding a window across the
raw row order would occasionally mix the tail of one VM's real trace
with the head of the next VM's, producing a fabricated (non-real)
sequence. build_vm_windows() groups by vm_id first and only slides
within each VM's own contiguous rows.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[3]
PROCESSED_DIR = ROOT / "dataset" / "processed"

# Real per-VM sequences here are only 45 ticks long (one Azure trace
# shard's 3.75h window - see dataset/dataset_description.md). N_STEPS=24
# (2h) from the original synthetic-data spec would leave too few real
# windows per VM after a 70/15/15 split; N_STEPS=6 (30 min context,
# predicting the next 5-min reading) is sized to the real data actually
# available while still leaving val/test with >=1 window per VM.
N_STEPS = 6


def load_split(name: str) -> pd.DataFrame:
    path = PROCESSED_DIR / f"{name}.csv"
    if not path.exists():
        raise FileNotFoundError(
            f"Processed split not found: {path}\n"
            "Run: python src/ml_model/preprocessing/preprocess.py"
        )
    return pd.read_csv(path)


def build_vm_windows(
    df: pd.DataFrame, n_steps: int = N_STEPS, col: str = "utilization_norm"
) -> tuple[np.ndarray, np.ndarray]:
    """Build (X, y) sliding windows, never crossing a vm_id boundary."""
    X, y = [], []
    for _, group in df.groupby("vm_id", sort=False):
        series = group.sort_values("timestamp")[col].values.astype(np.float32)
        for i in range(len(series) - n_steps):
            X.append(series[i : i + n_steps])
            y.append(series[i + n_steps])
    if not X:
        return np.empty((0, n_steps, 1), dtype=np.float32), np.empty((0,), dtype=np.float32)
    return np.array(X)[..., np.newaxis], np.array(y, dtype=np.float32)
