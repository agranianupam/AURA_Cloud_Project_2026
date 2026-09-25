"""
AURA baseline forecasters - REAL DATA VERSION.

Evaluated on the exact same (X, y) VM-windowed supervised pairs as the
LSTM (preprocessing/windowing.py), for an apples-to-apples comparison:
given a real VM's last N_STEPS (30 min) of readings, predict its next
5-min reading.

Holt-Winters seasonal smoothing (used in the original synthetic-data
pipeline) doesn't apply here: each window is only N_STEPS=6 points
long with no repeating cycle to decompose, and our real per-VM traces
span just 3.75h total - nowhere near a seasonal period. We use
non-seasonal simple exponential smoothing (SES) instead, which is the
correct degenerate case for a short, cycle-free real window.
"""
from __future__ import annotations

import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

from preprocessing.windowing import N_STEPS, build_vm_windows, load_split

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parents[2]
RESULTS_DIR = ROOT / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

SES_ALPHA = 0.3


def _metrics(y_true: np.ndarray, y_pred: np.ndarray, name: str) -> dict:
    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
    mae = float(mean_absolute_error(y_true, y_pred))
    r2 = float(r2_score(y_true, y_pred))
    print(f"  {name:<30}  RMSE={rmse:.4f}  MAE={mae:.4f}  R2={r2:.4f}")
    return {"model": name, "RMSE": rmse, "MAE": mae, "R2": r2}


def naive_persistence(X: np.ndarray) -> np.ndarray:
    """Predict next value = last value in the window."""
    return X[:, -1, 0]


def simple_moving_average(X: np.ndarray) -> np.ndarray:
    """Predict next value = mean of the window."""
    return X[:, :, 0].mean(axis=1)


def simple_exponential_smoothing(X: np.ndarray, alpha: float = SES_ALPHA) -> np.ndarray:
    """Non-seasonal SES, applied within each window; prediction = final
    smoothed level. Appropriate given no seasonal cycle exists in a
    single 30-minute real window (see module docstring)."""
    windows = X[:, :, 0]
    level = windows[:, 0].copy()
    for t in range(1, windows.shape[1]):
        level = alpha * windows[:, t] + (1 - alpha) * level
    return level


def _inverse(values: np.ndarray, scaler) -> np.ndarray:
    return scaler.inverse_transform(values.reshape(-1, 1)).flatten()


def run_baselines() -> list[dict]:
    print("\nAURA Baseline Models (real Azure VM panel)")
    print("=" * 50)

    import pickle

    scaler_path = Path(__file__).resolve().parent / "scaler.pkl"
    with open(scaler_path, "rb") as f:
        scaler = pickle.load(f)

    test_df = load_split("test")
    X_test, y_test = build_vm_windows(test_df, n_steps=N_STEPS)
    print(f"  Test windows: {X_test.shape[0]:,} (N_STEPS={N_STEPS}, real, VM-boundary-safe)")

    y_true = _inverse(y_test, scaler)

    results = []
    results.append(
        _metrics(y_true, _inverse(naive_persistence(X_test), scaler), "Naive persistence")
    )
    results.append(
        _metrics(y_true, _inverse(simple_moving_average(X_test), scaler), "Simple moving average")
    )
    results.append(
        _metrics(
            y_true,
            _inverse(simple_exponential_smoothing(X_test), scaler),
            "Simple exponential smoothing",
        )
    )

    df = pd.DataFrame(results)
    out = RESULTS_DIR / "baseline_metrics.csv"
    df.to_csv(out, index=False, float_format="%.6f")
    print(f"\n  Saved -> {out.relative_to(ROOT)}")
    return results


if __name__ == "__main__":
    run_baselines()
