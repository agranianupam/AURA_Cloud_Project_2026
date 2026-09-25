"""
AURA prediction interface - REAL DATA VERSION.

Same public contract as before (predict(n_steps) -> list of
{timestamp, predicted_utilization, scaling_recommendation,
 carbon_intensity, energy_kwh, baseline_energy_kwh,
 carbon_gco2, baseline_carbon_gco2}),
now backed by the LSTM trained on real Azure Public Dataset V2 VM readings
and extended per PRD FR-SC-4 to factor in both forecasted demand AND
current carbon intensity when generating scaling recommendations.

N_STEPS=6 matches preprocessing/windowing.py (see that module's
docstring for why the original N_STEPS=24 was replaced).

All energy and carbon figures are MODELLED ESTIMATES derived from the
documented power model (FR-SC-2, carbon_model.py). The underlying
dataset has no real energy or carbon measurements.
"""
from __future__ import annotations

import os
import pickle
import sys
import warnings
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

# Make sure the ml_model directory is on the path so relative imports work
# regardless of where the script is invoked from.
_ML_DIR = Path(__file__).resolve().parent
if str(_ML_DIR) not in sys.path:
    sys.path.insert(0, str(_ML_DIR))

ML_DIR = _ML_DIR
WEIGHTS_PATH = ML_DIR / "model_weights.keras"
SCALER_PATH = ML_DIR / "scaler.pkl"
PROCESSED = ML_DIR.parents[1] / "dataset" / "processed"

from preprocessing.windowing import N_STEPS
from scheduler.carbon_model import (
    get_carbon_intensity,
    get_aura_metrics,
    get_baseline_metrics,
)

_model = None
_scaler = None

_OFF_PEAK_START = 22
_OFF_PEAK_END = 6

# Carbon-intensity threshold: above this value (gCO2/kWh) the grid is
# considered "dirty" and deferrable jobs should be held back.
# Based on the documented static hourly profile in carbon_model.py;
# the midpoint between off-peak (~400) and peak (~600) intensity.
CARBON_DEFER_THRESHOLD_GCO2_KWH = 500.0

# Demand headroom: AURA always provisions slightly above the forecast
# to protect SLA compliance (PRD NFR-SLA >= 95% of intervals).
HEADROOM_PCT = 0.05  # 5% above predicted demand


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
    """Seed the autoregressive forecast with one real VM's own last
    N_STEPS readings from the real test split (not a synthetic default -
    falls back to a flat 0.4 series only if the processed data is
    entirely missing, e.g. before preprocess.py has ever been run)."""
    test_csv = PROCESSED / "test.csv"
    if test_csv.exists():
        df = pd.read_csv(test_csv)
        col = "utilization_norm" if "utilization_norm" in df.columns else "utilization"
        first_vm = df["vm_id"].iloc[0] if "vm_id" in df.columns else None
        if first_vm is not None:
            vm_series = df[df["vm_id"] == first_vm].sort_values("timestamp")[col].values
            if len(vm_series) >= N_STEPS:
                return vm_series[-N_STEPS:].astype(np.float32)
        series = df[col].values.astype(np.float32)
        if len(series) >= N_STEPS:
            return series[-N_STEPS:]
    return np.full(N_STEPS, 0.4, dtype=np.float32)


def _is_off_peak(dt: datetime) -> bool:
    h = dt.hour
    return h >= _OFF_PEAK_START or h < _OFF_PEAK_END


def _is_high_carbon(dt: datetime) -> bool:
    """True when the current carbon intensity exceeds the deferral threshold."""
    return get_carbon_intensity(dt) > CARBON_DEFER_THRESHOLD_GCO2_KWH


def _scaling_recommendation(utilization_pct: float, ts: datetime) -> str:
    """Carbon-aware scaling recommendation (FR-SC-4).

    Factors in BOTH forecasted demand AND current/forecasted carbon intensity:
    - Non-deferrable workloads (high demand, exam-period): always scale up.
    - Deferrable workloads: held back when grid is dirty OR off-peak + low demand.
    - Clean-grid windows: preferred time to run deferred batch work.
    """
    off_peak = _is_off_peak(ts)
    high_carbon = _is_high_carbon(ts)

    if utilization_pct > 80.0:
        # Non-deferrable: capacity must meet demand regardless of carbon.
        return "scale_up"

    if utilization_pct < 30.0 and high_carbon:
        # Low demand + dirty grid: ideal time to defer batch jobs.
        return "defer_batch_jobs_high_carbon"

    if utilization_pct < 30.0 and off_peak:
        # Low demand + off-peak (typically low carbon): still defer batch,
        # but note grid is clean so this is the preferred execution window
        # for already-deferred jobs.
        return "defer_batch_jobs"

    if utilization_pct < 30.0:
        return "scale_down"

    return "maintain"


def predict(n_steps: int = 12) -> list[dict]:
    """Generate an n_steps ahead forecast with carbon-aware scaling recommendations.

    Each step includes (FR-SC-4, FR-SC-5):
      - predicted_utilization: LSTM forecast (% CPU)
      - scaling_recommendation: carbon + demand aware action
      - carbon_intensity: grid gCO2/kWh at that timestamp (modelled)
      - energy_kwh: estimated energy for this 5-min interval at predicted demand
      - baseline_energy_kwh: energy at static 100% provisioning baseline
      - carbon_gco2: estimated carbon at predicted demand (modelled)
      - baseline_carbon_gco2: carbon at static baseline (modelled)

    All energy/carbon values are MODELLED ESTIMATES. See carbon_model.py for
    the documented power model parameters (P_idle, P_max, PUE).
    """
    model = _load_model()
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

        # Apply SLA headroom: provision slightly above forecast.
        provisioned_pct = min(100.0, pred_pct * (1.0 + HEADROOM_PCT))

        rec = _scaling_recommendation(pred_pct, ts)

        # Energy/carbon model (all MODELLED ESTIMATES — FR-SC-2, FR-SC-5).
        aura_metrics = get_aura_metrics(provisioned_pct, ts)
        baseline_metrics = get_baseline_metrics(ts)

        predictions.append(
            {
                "timestamp": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "predicted_utilization": pred_pct,
                "provisioned_capacity_pct": round(provisioned_pct, 2),
                "scaling_recommendation": rec,
                "carbon_intensity": aura_metrics["carbonIntensity"],
                "energy_kwh": aura_metrics["energyKwh"],
                "carbon_gco2": aura_metrics["carbonGco2"],
                "baseline_energy_kwh": baseline_metrics["baselineEnergyKwh"],
                "baseline_carbon_gco2": baseline_metrics["baselineCarbonGco2"],
            }
        )

        window.append(pred_norm)

    return predictions


if __name__ == "__main__":
    import json

    print("\nAURA Prediction Interface - Test Run (real-data model + carbon-aware)")
    print("=" * 68)
    print("Generating 12-step (1 hour) forecast ...\n")

    results = predict(n_steps=12)
    print(json.dumps(results, indent=2))

    recs = {r["scaling_recommendation"] for r in results}
    print(f"\n  Scaling recommendations seen: {recs}")
    print(
        f"  Utilisation range: "
        f"{min(r['predicted_utilization'] for r in results):.1f}% - "
        f"{max(r['predicted_utilization'] for r in results):.1f}%"
    )
    print(
        f"  Carbon intensity range: "
        f"{min(r['carbon_intensity'] for r in results):.0f} - "
        f"{max(r['carbon_intensity'] for r in results):.0f} gCO2/kWh (modelled)"
    )
    total_energy = sum(r["energy_kwh"] for r in results)
    total_baseline = sum(r["baseline_energy_kwh"] for r in results)
    print(f"  Energy this hour: {total_energy:.4f} kWh (AURA) vs {total_baseline:.4f} kWh (baseline) [modelled]\n")
