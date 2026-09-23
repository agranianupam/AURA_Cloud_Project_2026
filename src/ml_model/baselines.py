from __future__ import annotations

import os
import pickle
import warnings
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from statsmodels.tsa.holtwinters import ExponentialSmoothing

warnings.filterwarnings("ignore")

ROOT        = Path(__file__).resolve().parents[2]
PROCESSED   = ROOT / "dataset" / "processed"
RESULTS_DIR = ROOT / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

SCALER_PATH = Path(__file__).resolve().parent / "scaler.pkl"

SMA_WINDOW = 12


def _load_split(name: str) -> pd.Series:
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
    print(f"  {name:<30}  RMSE={rmse:.4f}  MAE={mae:.4f}  R2={r2:.4f}")
    return {"model": name, "RMSE": rmse, "MAE": mae, "R2": r2}


def naive_persistence(train: pd.Series, test: pd.Series) -> np.ndarray:
    last_train_val = train.iloc[-1]
    preds = np.empty(len(test))
    preds[0] = last_train_val
    for i in range(1, len(test)):
        preds[i] = test.iloc[i - 1]
    return preds


def simple_moving_average(train: pd.Series, test: pd.Series, window: int = SMA_WINDOW) -> np.ndarray:
    buffer = list(train.iloc[-window:])
    preds = []
    for actual in test:
        preds.append(np.mean(buffer))
        buffer.append(float(actual))
        if len(buffer) > window:
            buffer.pop(0)
    return np.array(preds)


def holt_winters(train: pd.Series, test: pd.Series) -> np.ndarray:
    period = min(288, len(train) // 2)
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


def plot_comparison(results: list[dict]) -> None:
    models = [r["model"] for r in results]
    rmse   = [r["RMSE"]  for r in results]
    mae    = [r["MAE"]   for r in results]
    r2     = [r["R2"]    for r in results]

    fig, axes = plt.subplots(1, 3, figsize=(14, 5))
    fig.suptitle("AURA - Baseline Model Comparison", fontsize=14, fontweight="bold")

    bar_colors = ["#4C72B0", "#DD8452", "#55A868"]

    for ax, values, title, ylabel in zip(
        axes,
        [rmse, mae, r2],
        ["RMSE (lower = better)", "MAE (lower = better)", "R2 (higher = better)"],
        ["RMSE", "MAE", "R2"],
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
    print(f"\n  Plot saved -> {out.relative_to(ROOT)}")


def save_metrics_table(results: list[dict]) -> None:
    df = pd.DataFrame(results)
    out = RESULTS_DIR / "baseline_metrics.csv"
    df.to_csv(out, index=False, float_format="%.6f")
    print(f"  Metrics table saved -> {out.relative_to(ROOT)}")


def run_baselines() -> list[dict]:
    print("\nAURA Baseline Models")
    print("=" * 50)

    print("\n[1/2] Loading processed data ...")
    train = _load_split("train")
    val   = _load_split("val")
    test  = _load_split("test")

    history = pd.concat([train, val], ignore_index=True)
    print(f"      train={len(train):,}  val={len(val):,}  test={len(test):,}")

    print("\n[2/2] Running baselines on test set ...")
    results: list[dict] = []

    preds_naive = naive_persistence(history, test)
    results.append(_metrics(test.values, preds_naive, "Naive Persistence"))

    preds_sma = simple_moving_average(history, test, window=SMA_WINDOW)
    results.append(_metrics(test.values, preds_sma, "Moving Average (w=12)"))

    preds_hw = holt_winters(history, test)
    results.append(_metrics(test.values, preds_hw, "Holt-Winters"))

    print("\n")
    plot_comparison(results)
    save_metrics_table(results)

    print("\nBaselines complete. Results in results/")
    return results


if __name__ == "__main__":
    run_baselines()
