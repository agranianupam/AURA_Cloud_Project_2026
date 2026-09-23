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

ML_DIR       = Path(__file__).resolve().parent
WEIGHTS_PATH = ML_DIR / "model_weights.keras"
SCALER_PATH  = ML_DIR / "scaler.pkl"
PROCESSED    = ML_DIR.parents[1] / "dataset" / "processed"

N_STEPS = 24

_model = None
_scaler = None

_OFF_PEAK_START = 22
_OFF_PEAK_END   = 6


def _load_model():
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
    global _scaler
    if _scaler is not None:
        return _scaler

    if not SCALER_PATH.exists():
        return None

    with open(SCALER_PATH, "rb") as f:
        _scaler = pickle.load(f)
    return _scaler


def _get_seed_sequence() -> np.ndarray:
    test_csv = PROCESSED / "test.csv"
    if test_csv.exists():
        df = pd.read_csv(test_csv)
        col = "utilization_norm" if "utilization_norm" in df.columns else "utilization"
        series = df[col].values.astype(np.float32)
        seed = series[-N_STEPS:]
    else:
        seed = np.full(N_STEPS, 0.4, dtype=np.float32)
    return seed


def _is_off_peak(dt: datetime) -> bool:
    h = dt.hour
    return h >= _OFF_PEAK_START or h < _OFF_PEAK_END


def _scaling_recommendation(utilization_pct: float, ts: datetime) -> str:
    if utilization_pct < 30.0 and _is_off_peak(ts):
        return "defer_batch_jobs"
    if utilization_pct > 80.0:
        return "scale_up"
    if utilization_pct < 30.0:
        return "scale_down"
    return "maintain"


def predict(n_steps: int = 12) -> list[dict]:
    model  = _load_model()
    scaler = _load_scaler()

    window = list(_get_seed_sequence())
    predictions = []
    now = datetime.now(tz=timezone.utc)

    for step in range(n_steps):
        x = np.array(window[-N_STEPS:], dtype=np.float32).reshape(1, N_STEPS, 1)
        pred_norm = float(model.predict(x, verbose=0)[0, 0])
        pred_norm = float(np.clip(pred_norm, 0.0, 1.0))

        if scaler is not None:
            pred_pct = float(scaler.inverse_transform([[pred_norm]])[0, 0])
        else:
            pred_pct = pred_norm * 100.0

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

        window.append(pred_norm)

    return predictions


if __name__ == "__main__":
    import json

    print("\nAURA Prediction Interface - Test Run")
    print("=" * 45)
    print("Generating 12-step (1 hour) forecast ...\n")

    results = predict(n_steps=12)
    print(json.dumps(results, indent=2))

    recs = {r["scaling_recommendation"] for r in results}
    print(f"\n  Scaling recommendations seen: {recs}")
    print(f"  Utilisation range: "
          f"{min(r['predicted_utilization'] for r in results):.1f}% - "
          f"{max(r['predicted_utilization'] for r in results):.1f}%\n")
