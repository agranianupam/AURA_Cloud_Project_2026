"""
AURA — Baseline Forecasting Models
=====================================
Implements three baseline models to set the performance bar that LSTM must beat:

  1. Naive Persistence  — predict last observed value
  2. Simple Moving Average (SMA, window = 12 steps = 1 hour @ 5-min intervals)
  3. Holt-Winters Exponential Smoothing (additive trend + seasonality, period=288 days)

Metrics computed on the test split: RMSE, MAE, R²

Outputs written to results/:
  baseline_metrics.csv        — numeric results table
  baseline_comparison.png     — bar chart comparing all three models

Run (after preprocessing):
  python src/ml_model/baselines.py
"""

from __future__ import annotations

import os
import pickle
import warnings
from pathlib import Path

import matplotlib
matplotlib.use("Agg")   # non-interactive backend — safe for servers
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from statsmodels.tsa.holtwinters import ExponentialSmoothing

warnings.filterwarnings("ignore")   # suppress statsmodels convergence warnings

# ── Paths ─────────────────────────────────────────────────────────────────────

ROOT        = Path(__file__).resolve().parents[2]   # repo root
PROCESSED   = ROOT / "dataset" / "processed"
RESULTS_DIR = ROOT / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

SCALER_PATH = Path(__file__).resolve().parent / "scaler.pkl"

# ── Helpers ───────────────────────────────────────────────────────────────────

def _load_split(name: str) -> pd.Series:
    """Load a processed CSV split and return the raw (un-normalised) utilization series."""
    path = PROCESSED / f"{name}.csv"
    if not path.exists():
        raise FileNotFoundError(
            f"Processed split not found: {path}\n"
            "Run preprocessing first:  python src/ml_model/preprocessing/preprocess.py"
        )
    df = pd.read_csv(path, parse_dates=["timestamp"])
    return df["utilization"].reset_index(drop=True)


def _metrics(y_true: np.ndarray, y_pred: np.ndarray, name: str) -> dict:
    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
    mae  = float(mean_absolute_error(y_true, y_pred))
    r2   = float(r2_score(y_true, y_pred))
    print(f"  {name:<30}  RMSE={rmse:.4f}  MAE={mae:.4f}  R²={r2:.4f}")
    return {"model": name, "RMSE": rmse, "MAE": mae, "R2": r2}


# ── Baseline 1: Naive Persistence ─────────────────────────────────────────────

def naive_persistence(train: pd.Series, test: pd.Series) -> np.ndarray:
    """
    Predict each test step as the immediately preceding observed value.
    The 'last known' value at test start is the final value of train.
    """
    last_train_val = train.iloc[-1]
    # For step i, predict train[-1] for i=0, then test[i-1] for i>0
    preds = np.empty(len(test))
    preds[0] = last_train_val
    for i in range(1, len(test)):
        preds[i] = test.iloc[i - 1]
    return preds


# ── Baseline 2: Simple Moving Average ─────────────────────────────────────────

SMA_WINDOW = 12   # 12 × 5 min = 1 hour


def simple_moving_average(train: pd.Series, test: pd.Series, window: int = SMA_WINDOW) -> np.ndarray:
    """
    Expanding moving average: maintain a running buffer of the last `window`
    observations. For each test step, predict the mean of the buffer, then
    roll in the true value (simulates a real-world walk-forward scenario).
    """
    buffer = list(train.iloc[-window:])
    preds = []
    for actual in test:
        preds.append(np.mean(buffer))
        buffer.append(float(actual))
        if len(buffer) > window:
            buffer.pop(0)
    return np.array(preds)


# ── Baseline 3: Holt-Winters Exponential Smoothing ────────────────────────────

def holt_winters(train: pd.Series, test: pd.Series) -> np.ndarray:
    """
    Fit an additive Holt-Winters model on the training series, then produce
    a multi-step forecast over the entire test horizon in one shot.

    Seasonality period: 288 (one full day at 5-min resolution).
    Falls back to a shorter period if train is too small.
    """
    period = min(288, len(train) // 2)   # safety: need ≥ 2× period in train
    period = max(period, 2)

    print(f"     Fitting Holt-Winters (period={period}, n_train={len(train):,}) ...")
    model = ExponentialSmoothing(
        train,
        trend="add",
        seasonal="add",
        seasonal_periods=period,
        initialization_method="estimated",
    )
    fit = model.fit(optimized=True, use_brute=False)
    return fit.forecast(len(test)).values


# ── Plotting ──────────────────────────────────────────────────────────────────

def plot_comparison(results: list[dict]) -> None:
    models = [r["model"] for r in results]
    rmse   = [r["RMSE"]  for r in results]
    mae    = [r["MAE"]   for r in results]
    r2     = [r["R2"]    for r in results]

    fig, axes = plt.subplots(1, 3, figsize=(14, 5))
    fig.suptitle("AURA — Baseline Model Comparison", fontsize=14, fontweight="bold")

    bar_colors = ["#4C72B0", "#DD8452", "#55A868"]

    for ax, values, title, ylabel in zip(
        axes,
        [rmse, mae, r2],
        ["RMSE (lower = better)", "MAE (lower = better)", "R² (higher = better)"],
        ["RMSE", "MAE", "R²"],
    ):
        bars = ax.bar(models, values, color=bar_colors, edgecolor="white", linewidth=0.8)
        ax.set_title(title, fontsize=10)
        ax.set_ylabel(ylabel)
        ax.set_xticklabels(models, rotation=15, ha="right", fontsize=8)
        for bar, val in zip(bars, values):
            ax.text(
                bar.get_x() + bar.get_width() / 2,
                bar.get_height() + 0.002,
                f"{val:.4f}",
                ha="center", va="bottom", fontsize=7,
            )

    plt.tight_layout()
    out = RESULTS_DIR / "baseline_comparison.png"
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"\n  📊 Plot saved → {out.relative_to(ROOT)}")


def save_metrics_table(results: list[dict]) -> None:
    df = pd.DataFrame(results)
    out = RESULTS_DIR / "baseline_metrics.csv"
    df.to_csv(out, index=False, float_format="%.6f")
    print(f"  📄 Metrics table saved → {out.relative_to(ROOT)}")


# ── Main ──────────────────────────────────────────────────────────────────────

def run_baselines() -> list[dict]:
    print("\n📊 AURA Baseline Models")
    print("=" * 50)

    print("\n[1/2] Loading processed data ...")
    train = _load_split("train")
    val   = _load_split("val")
    test  = _load_split("test")

    # Use train + val as the full "history" for prediction
    history = pd.concat([train, val], ignore_index=True)

    print(f"      train={len(train):,}  val={len(val):,}  test={len(test):,}")

    print("\n[2/2] Running baselines on test set ...")
    results: list[dict] = []

    # 1. Naive Persistence
    preds_naive = naive_persistence(history, test)
    results.append(_metrics(test.values, preds_naive, "Naive Persistence"))

    # 2. Simple Moving Average
    preds_sma = simple_moving_average(history, test, window=SMA_WINDOW)
    results.append(_metrics(test.values, preds_sma, "Moving Average (w=12)"))

    # 3. Holt-Winters
    preds_hw = holt_winters(history, test)
    results.append(_metrics(test.values, preds_hw, "Holt-Winters"))

    print("\n")
    plot_comparison(results)
    save_metrics_table(results)

    print("\n✅ Baselines complete. Results in results/")
    print("   LSTM must beat ALL three on RMSE, MAE, and R².\n")
    return results


if __name__ == "__main__":
    run_baselines()
