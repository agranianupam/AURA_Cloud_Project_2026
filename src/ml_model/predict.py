"""
AURA — Prediction Interface
==============================
Public API used by all deployment paths (FastAPI, Lambda, SageMaker).

Usage:
  from predict import predict

  results = predict(n_steps=12)
  # → list of 12 dicts:
  # {
  #   "timestamp": "2026-08-01T14:00:00Z",
  #   "predicted_utilization": 72.4,
  #   "scaling_recommendation": "maintain"
  # }

Scaling logic:
  predicted_utilization > 80%  → "scale_up"
  predicted_utilization < 30%  → "scale_down"
  else                         → "maintain"

Carbon-aware override:
  If predicted_utilization < 30% AND time is off-peak (22:00–06:00 UTC)
  → "defer_batch_jobs"  (green scheduling)

Standalone test:
  python src/ml_model/predict.py
"""

from __future__ import annotations

import os
import pickle
import warnings
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

# ── Paths ─────────────────────────────────────────────────────────────────────

ML_DIR      = Path(__file__).resolve().parent
WEIGHTS_PATH = ML_DIR / "model_weights.h5"
SCALER_PATH  = ML_DIR / "scaler.pkl"
PROCESSED    = ML_DIR.parents[1] / "dataset" / "processed"

N_STEPS = 24   # must match lstm_model.py

# ── Lazy model loader (singleton pattern) ─────────────────────────────────────

_model = None
_scaler = None


def _load_model():
    """Load the trained LSTM model (cached after first call)."""
    global _model
    if _model is not None:
        return _model

    import tensorflow as tf

    if not WEIGHTS_PATH.exists():
        raise FileNotFoundError(
            f"Model weights not found at {WEIGHTS_PATH}.\n"
            "Train the model first:  python src/ml_model/lstm_model.py"
        )

    _model = tf.keras.models.load_model(str(WEIGHTS_PATH))
    return _model


def _load_scaler():
    """Load the fitted MinMaxScaler (cached after first call)."""
    global _scaler
    if _scaler is not None:
        return _scaler

    if not SCALER_PATH.exists():
        return None   # raw values — no inverse transform

    with open(SCALER_PATH, "rb") as f:
        _scaler = pickle.load(f)
    return _scaler


# ── Seed sequence ─────────────────────────────────────────────────────────────

def _get_seed_sequence() -> np.ndarray:
    """
    Return the last N_STEPS normalised values from the test set to seed
    the rolling forecast.
    Falls back to a constant 0.4 seed if processed data is unavailable.
    """
    test_csv = PROCESSED / "test.csv"
    if test_csv.exists():
        df = pd.read_csv(test_csv)
        col = "utilization_norm" if "utilization_norm" in df.columns else "utilization"
        series = df[col].values.astype(np.float32)
        seed = series[-N_STEPS:]
    else:
        # Fallback: ~40% normalised utilisation seed
        seed = np.full(N_STEPS, 0.4, dtype=np.float32)

    return seed


# ── Scaling & carbon logic ────────────────────────────────────────────────────

_OFF_PEAK_START = 22   # 10 PM UTC
_OFF_PEAK_END   = 6    # 6 AM UTC


def _is_off_peak(dt: datetime) -> bool:
    h = dt.hour
    return h >= _OFF_PEAK_START or h < _OFF_PEAK_END


def _scaling_recommendation(utilization_pct: float, ts: datetime) -> str:
    """
    Return a scaling recommendation string.

    Priority:
      1. Carbon-aware: low demand + off-peak → defer batch jobs
      2. High demand → scale_up
      3. Low demand  → scale_down
      4. Normal      → maintain
    """
    if utilization_pct < 30.0 and _is_off_peak(ts):
        return "defer_batch_jobs"
    if utilization_pct > 80.0:
        return "scale_up"
    if utilization_pct < 30.0:
        return "scale_down"
    return "maintain"


# ── Public API ────────────────────────────────────────────────────────────────

def predict(n_steps: int = 12) -> list[dict]:
    """
    Generate `n_steps` future utilisation predictions starting from now.

    Each prediction step is 5 minutes ahead of the previous.

    Returns:
        list of dicts:
        [
          {
            "timestamp": "2026-08-01T14:00:00Z",
            "predicted_utilization": 72.4,
            "scaling_recommendation": "maintain"
          },
          ...
        ]
    """
    model  = _load_model()
    scaler = _load_scaler()

    # Rolling forecast — use actual model to predict one step at a time
    window = list(_get_seed_sequence())
    predictions = []
    now = datetime.now(tz=timezone.utc)

    for step in range(n_steps):
        x = np.array(window[-N_STEPS:], dtype=np.float32).reshape(1, N_STEPS, 1)
        pred_norm = float(model.predict(x, verbose=0)[0, 0])

        # Clamp to [0, 1] before inverse-transform
        pred_norm = float(np.clip(pred_norm, 0.0, 1.0))

        # Inverse transform to percentage
        if scaler is not None:
            pred_pct = float(scaler.inverse_transform([[pred_norm]])[0, 0])
        else:
            pred_pct = pred_norm * 100.0   # assume raw % if no scaler

        pred_pct = round(float(np.clip(pred_pct, 0.0, 100.0)), 2)

        ts = now + timedelta(minutes=5 * (step + 1))
        rec = _scaling_recommendation(pred_pct, ts)

        predictions.append(
            {
                "timestamp": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "predicted_utilization": pred_pct,
                "scaling_recommendation": rec,
            }
        )

        # Roll window forward with the new prediction (normalised)
        window.append(pred_norm)

    return predictions


# ── Standalone test ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    import json

    print("\n🔮 AURA Prediction Interface — Test Run")
    print("=" * 45)
    print("Generating 12-step (1 hour) forecast ...\n")

    results = predict(n_steps=12)
    print(json.dumps(results, indent=2))

    recs = {r["scaling_recommendation"] for r in results}
    print(f"\n  Scaling recommendations seen: {recs}")
    print(f"  Utilisation range: "
          f"{min(r['predicted_utilization'] for r in results):.1f}% – "
          f"{max(r['predicted_utilization'] for r in results):.1f}%\n")
