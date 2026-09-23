"""
AURA — LSTM Demand Forecasting Model
=======================================
Architecture:
  Input  → LSTM(64, return_sequences=True)
         → Dropout(0.2)
         → LSTM(32)
         → Dropout(0.2)
         → Dense(1)

Training:
  • Loss: MSE | Optimiser: Adam (lr=0.001)
  • ReduceLROnPlateau (factor=0.5, patience=5, min_lr=1e-6)
  • EarlyStopping (patience=10, restore_best_weights=True)
  • Sliding-window sequences of length N_STEPS (default 24 = 2 hours)

Acceptance criterion:
  LSTM MUST outperform ALL three baselines on RMSE, MAE, AND R².
  If it fails, the script prints a diagnostic report and exits with code 1
  so the CI pipeline surfaces the failure.

Outputs written to:
  src/ml_model/model_weights.h5    — best model weights
  src/ml_model/scaler.pkl          — MinMaxScaler (fitted in preprocessing)
  results/lstm_training_history.png
  results/metrics_comparison.csv
  results/metrics_comparison.png

Run:
  python src/ml_model/lstm_model.py
"""

from __future__ import annotations

import os
import pickle
import sys
import warnings
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

warnings.filterwarnings("ignore")

# Suppress TF verbose startup logs
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

import tensorflow as tf
from tensorflow.keras.callbacks import EarlyStopping, ModelCheckpoint, ReduceLROnPlateau
from tensorflow.keras.layers import Dense, Dropout, LSTM
from tensorflow.keras.models import Sequential

# ── Reproducibility ───────────────────────────────────────────────────────────

SEED = 42
np.random.seed(SEED)
tf.random.set_seed(SEED)

# ── Paths ─────────────────────────────────────────────────────────────────────

ROOT        = Path(__file__).resolve().parents[2]
PROCESSED   = ROOT / "dataset" / "processed"
RESULTS_DIR = ROOT / "results"
ML_DIR      = Path(__file__).resolve().parent

RESULTS_DIR.mkdir(parents=True, exist_ok=True)

WEIGHTS_PATH = ML_DIR / "model_weights.h5"
SCALER_PATH  = ML_DIR / "scaler.pkl"

# ── Hyperparameters ───────────────────────────────────────────────────────────

N_STEPS      = 24      # look-back window: 24 × 5 min = 2 hours
LSTM_UNITS_1 = 64
LSTM_UNITS_2 = 32
DROPOUT_RATE = 0.2
BATCH_SIZE   = 64
MAX_EPOCHS   = 100
LEARNING_RATE= 0.001

# ── Data helpers ──────────────────────────────────────────────────────────────

def _load_split(name: str, col: str = "utilization_norm") -> np.ndarray:
    path = PROCESSED / f"{name}.csv"
    if not path.exists():
        raise FileNotFoundError(
            f"Processed split not found: {path}\n"
            "Run: python src/ml_model/preprocessing/preprocess.py"
        )
    df = pd.read_csv(path)

    # Graceful fallback: if normalised column absent, use raw and normalise here
    if col not in df.columns:
        print(f"  ⚠️  Column '{col}' not found; falling back to 'utilization'.")
        col = "utilization"

    return df[col].values.astype(np.float32)


def _build_sequences(series: np.ndarray, n_steps: int) -> tuple[np.ndarray, np.ndarray]:
    """Create sliding-window (X, y) pairs. X shape: (samples, n_steps, 1)."""
    X, y = [], []
    for i in range(len(series) - n_steps):
        X.append(series[i : i + n_steps])
        y.append(series[i + n_steps])
    return np.array(X)[..., np.newaxis], np.array(y)


# ── Model ─────────────────────────────────────────────────────────────────────

def build_model(n_steps: int) -> tf.keras.Model:
    model = Sequential(
        [
            LSTM(LSTM_UNITS_1, return_sequences=True, input_shape=(n_steps, 1)),
            Dropout(DROPOUT_RATE),
            LSTM(LSTM_UNITS_2),
            Dropout(DROPOUT_RATE),
            Dense(1),
        ],
        name="AURA_LSTM",
    )
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=LEARNING_RATE),
        loss="mse",
        metrics=["mae"],
    )
    return model


# ── Training ──────────────────────────────────────────────────────────────────

def train(model: tf.keras.Model, X_tr, y_tr, X_val, y_val) -> tf.keras.callbacks.History:
    callbacks = [
        EarlyStopping(
            monitor="val_loss",
            patience=10,
            restore_best_weights=True,
            verbose=1,
        ),
        ReduceLROnPlateau(
            monitor="val_loss",
            factor=0.5,
            patience=5,
            min_lr=1e-6,
            verbose=1,
        ),
        ModelCheckpoint(
            filepath=str(WEIGHTS_PATH),
            monitor="val_loss",
            save_best_only=True,
            verbose=0,
        ),
    ]

    history = model.fit(
        X_tr, y_tr,
        validation_data=(X_val, y_val),
        epochs=MAX_EPOCHS,
        batch_size=BATCH_SIZE,
        callbacks=callbacks,
        verbose=1,
    )
    return history


# ── Evaluation ────────────────────────────────────────────────────────────────

def _inverse_transform(values: np.ndarray) -> np.ndarray:
    """Inverse-transform normalised predictions back to % utilisation."""
    if not SCALER_PATH.exists():
        # No scaler — assume raw values were used
        return values
    with open(SCALER_PATH, "rb") as f:
        scaler = pickle.load(f)
    return scaler.inverse_transform(values.reshape(-1, 1)).flatten()


def evaluate(model: tf.keras.Model, X_test: np.ndarray, y_test: np.ndarray) -> dict:
    """Return RMSE, MAE, R² on the test set (in original scale)."""
    y_pred_norm = model.predict(X_test, verbose=0).flatten()

    y_pred = _inverse_transform(y_pred_norm)
    y_true = _inverse_transform(y_test)

    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
    mae  = float(mean_absolute_error(y_true, y_pred))
    r2   = float(r2_score(y_true, y_pred))
    return {"model": "LSTM (2-layer)", "RMSE": rmse, "MAE": mae, "R2": r2}


# ── Plotting ──────────────────────────────────────────────────────────────────

def plot_training_history(history: tf.keras.callbacks.History) -> None:
    fig, axes = plt.subplots(1, 2, figsize=(12, 4))
    fig.suptitle("AURA LSTM — Training History", fontsize=13, fontweight="bold")

    for ax, metric, title in zip(
        axes,
        ["loss", "mae"],
        ["Loss (MSE)", "MAE"],
    ):
        ax.plot(history.history[metric], label="Train", color="#4C72B0")
        val_key = f"val_{metric}"
        if val_key in history.history:
            ax.plot(history.history[val_key], label="Val", color="#DD8452", linestyle="--")
        ax.set_title(title)
        ax.set_xlabel("Epoch")
        ax.legend()
        ax.grid(alpha=0.3)

    plt.tight_layout()
    out = RESULTS_DIR / "lstm_training_history.png"
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  📊 Training history plot → {out.relative_to(ROOT)}")


def plot_metrics_comparison(all_results: list[dict]) -> None:
    """Bar chart comparing LSTM against baselines."""
    df = pd.DataFrame(all_results)
    df.to_csv(RESULTS_DIR / "metrics_comparison.csv", index=False, float_format="%.6f")
    print(f"  📄 Metrics comparison → results/metrics_comparison.csv")

    fig, axes = plt.subplots(1, 3, figsize=(15, 5))
    fig.suptitle("AURA — LSTM vs Baselines", fontsize=14, fontweight="bold")

    colors = ["#4C72B0", "#DD8452", "#55A868", "#C44E52"]   # last = LSTM highlight

    for ax, metric, title in zip(
        axes,
        ["RMSE", "MAE", "R2"],
        ["RMSE (lower = better)", "MAE (lower = better)", "R² (higher = better)"],
    ):
        bar_colors = colors[: len(df)]
        bars = ax.bar(df["model"], df[metric], color=bar_colors, edgecolor="white")
        ax.set_title(title, fontsize=10)
        ax.set_xticklabels(df["model"], rotation=15, ha="right", fontsize=7)
        for bar, val in zip(bars, df[metric]):
            ax.text(
                bar.get_x() + bar.get_width() / 2,
                bar.get_height() + 0.001,
                f"{val:.4f}",
                ha="center", va="bottom", fontsize=7,
            )

    plt.tight_layout()
    out = RESULTS_DIR / "metrics_comparison.png"
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  📊 Comparison plot → {out.relative_to(ROOT)}")


# ── Diagnostic report if LSTM underperforms ───────────────────────────────────

def diagnose_underperformance(lstm_metrics: dict, baseline_results: list[dict]) -> None:
    print("\n" + "=" * 60)
    print("  ⚠️  LSTM DID NOT BEAT ALL BASELINES. DIAGNOSTIC REPORT:")
    print("=" * 60)
    for b in baseline_results:
        for metric in ["RMSE", "MAE", "R2"]:
            if metric in ("RMSE", "MAE"):
                worse = lstm_metrics[metric] >= b[metric]
            else:
                worse = lstm_metrics[metric] <= b[metric]
            if worse:
                print(f"  ✗ {metric}: LSTM={lstm_metrics[metric]:.4f}  {b['model']}={b[metric]:.4f}")

    print("\n  Likely causes & fixes:")
    print("  1. DATA LEAKAGE  — check that test split is strictly after train+val.")
    print("  2. SEQUENCE LEN  — try N_STEPS=48 (4 hr) or 96 (8 hr).")
    print("  3. ARCHITECTURE  — add a third LSTM layer or increase units.")
    print("  4. TRAINING TIME — increase MAX_EPOCHS or lower EarlyStopping patience.")
    print("  5. BATCH SIZE    — try 32 instead of 64.")
    print("  6. CONVERGENCE   — check val_loss plateaued early; reduce initial LR.")
    print("\n  Do NOT inflate/hardcode results.\n")


# ── Main ──────────────────────────────────────────────────────────────────────

def run_lstm() -> dict:
    print("\n🧠 AURA LSTM Model Training")
    print("=" * 50)

    # ── Load data ──────────────────────────────────────────────────────────
    print("\n[1/5] Loading processed splits ...")
    try:
        train_series = _load_split("train")
        val_series   = _load_split("val")
        test_series  = _load_split("test")
    except FileNotFoundError as e:
        print(f"\n❌ {e}")
        sys.exit(1)

    print(f"      train={len(train_series):,}  val={len(val_series):,}  test={len(test_series):,}")

    # ── Build sequences ────────────────────────────────────────────────────
    print(f"\n[2/5] Building sliding-window sequences (N_STEPS={N_STEPS}) ...")
    X_tr,  y_tr  = _build_sequences(train_series, N_STEPS)
    X_val, y_val = _build_sequences(val_series,   N_STEPS)
    X_te,  y_te  = _build_sequences(test_series,  N_STEPS)
    print(f"      X_train={X_tr.shape}  X_val={X_val.shape}  X_test={X_te.shape}")

    # ── Build model ────────────────────────────────────────────────────────
    print("\n[3/5] Building LSTM model ...")
    model = build_model(N_STEPS)
    model.summary()

    # ── Train ──────────────────────────────────────────────────────────────
    print(f"\n[4/5] Training (max {MAX_EPOCHS} epochs, early stopping patience=10) ...")
    history = train(model, X_tr, y_tr, X_val, y_val)
    epochs_run = len(history.history["loss"])
    print(f"      Stopped at epoch {epochs_run}")

    # ── Evaluate ───────────────────────────────────────────────────────────
    print("\n[5/5] Evaluating on test set ...")
    lstm_metrics = evaluate(model, X_te, y_te)
    print(f"\n  LSTM Results:")
    for k, v in lstm_metrics.items():
        if isinstance(v, float):
            print(f"    {k}: {v:.4f}")

    # ── Plot training history ──────────────────────────────────────────────
    plot_training_history(history)

    # ── Load baseline results (if available) and plot comparison ──────────
    baseline_csv = RESULTS_DIR / "baseline_metrics.csv"
    if baseline_csv.exists():
        baseline_df = pd.read_csv(baseline_csv)
        baseline_results = baseline_df.to_dict("records")
        all_results = baseline_results + [lstm_metrics]
        plot_metrics_comparison(all_results)

        # Check acceptance criterion
        passed = all(
            lstm_metrics["RMSE"] < b["RMSE"]
            and lstm_metrics["MAE"] < b["MAE"]
            and lstm_metrics["R2"] > b["R2"]
            for b in baseline_results
        )

        if passed:
            print("\n✅ ACCEPTANCE CRITERION MET: LSTM beats all baselines on RMSE, MAE, and R².")
        else:
            diagnose_underperformance(lstm_metrics, baseline_results)
            sys.exit(1)   # fail loudly so it's visible in git CI
    else:
        print("\n  ⚠️  No baseline_metrics.csv found. Run baselines.py first for comparison.")
        all_results = [lstm_metrics]
        plot_metrics_comparison(all_results)

    print(f"\n  💾 Weights saved → {WEIGHTS_PATH.relative_to(ROOT)}")
    print(f"  Results in results/\n")
    return lstm_metrics


if __name__ == "__main__":
    run_lstm()
