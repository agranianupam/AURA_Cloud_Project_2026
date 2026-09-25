"""
AURA carbon model — power, energy, and carbon estimation (FR-SC-1, FR-SC-2).

File ownership: src/ml_model/scheduler/ (Agrani Anupam — AI/ML track).

IMPORTANT — ALL VALUES ARE MODELLED ESTIMATES:
The Azure Public Dataset V2 contains CPU utilization data only. It has no
real energy or carbon measurements. All energy (kWh) and carbon (gCO2)
figures in this module are derived from the documented power model below
and must be labelled as modelled estimates wherever reported (PRD NFR-Reliability).

Power model (FR-SC-2):
    Power (W) = P_idle + (P_max - P_idle) × utilization_fraction
    Energy (kWh) = Power × PUE × interval_hours / 1000
    Carbon (gCO2) = Energy (kWh) × carbon_intensity (gCO2/kWh)
    Savings = Baseline (static 100%) − AURA (forecast + carbon-aware)

Default assumptions (documented; adjust in dataset_description.md):
    P_idle  = 100 W  (server idle power, illustrative)
    P_max   = 250 W  (server peak power, illustrative)
    PUE     = 1.5    (Power Usage Effectiveness; fixed assumption, not modelled)

Carbon-intensity signal (FR-SC-1):
    Source: documented static hourly profile built from published grid
    emission factors (US average grid: ~400–600 gCO2/kWh depending on
    time of day). A public real-time API (e.g. Electricity Maps) is not
    used here because it requires an API key and live internet access,
    making it unsuitable for reproducible demo/evaluation runs. The profile
    is documented as a fallback per PRD FR-SC-1 and labelled accordingly.
    If a live API key is available, set ELECTRICITY_MAPS_API_KEY in .env
    and call get_carbon_intensity_live() below instead.
"""
from __future__ import annotations

import math
import os
from datetime import datetime
from typing import Optional

# ---------------------------------------------------------------------------
# Power model parameters (FR-SC-2)
# All are illustrative documented defaults; see dataset_description.md.
# ---------------------------------------------------------------------------
P_IDLE_W = 100.0       # Watts at idle
P_MAX_W = 250.0        # Watts at peak utilization
PUE = 1.5              # Power Usage Effectiveness (fixed assumption)
INTERVAL_HOURS = 5 / 60.0  # 5-minute reading interval in hours

# Static baseline: always-on, 100% provisioned (no optimization)
BASELINE_UTILIZATION = 100.0

# ---------------------------------------------------------------------------
# Carbon-intensity signal (FR-SC-1)
# ---------------------------------------------------------------------------

def get_carbon_intensity(dt: datetime) -> float:
    """
    Hourly grid carbon-intensity signal (gCO2/kWh).

    Source: documented static time-of-day profile (FR-SC-1 fallback).
    Based on published US average grid emission factors:
      - Peak daytime (08:00–18:00): 550–600 gCO2/kWh (fossil-heavy load)
      - Off-peak (18:00–08:00): ~380–450 gCO2/kWh (more renewables)

    The profile is a smooth sinusoidal approximation of diurnal grid
    carbon variation — acknowledged as a simplification, labelled as a
    modelled estimate. No real-time grid API is queried here.

    To use a live source instead (e.g. Electricity Maps), set:
        ELECTRICITY_MAPS_API_KEY=<your key>
    and call get_carbon_intensity_live(dt, zone="US-MIDA-PJM") below.
    """
    hour = dt.hour
    if 8 <= hour <= 18:
        # Peak window: rises from 550 at 08:00, peaks ~600 at 13:00, returns to 550 at 18:00
        return 550.0 + 50.0 * math.sin(math.pi * (hour - 8) / 10)
    else:
        # Off-peak: oscillates between ~380 and ~450
        return 400.0 - 50.0 * math.cos(math.pi * ((hour + 6) % 24) / 14)


def get_carbon_intensity_live(dt: datetime, zone: str = "US-MIDA-PJM") -> Optional[float]:
    """
    Attempt to fetch a live carbon intensity value from the Electricity Maps
    API (https://www.electricitymaps.com/). Returns None on any error so the
    caller can fall back to get_carbon_intensity() (the documented static
    profile, FR-SC-1 fallback).

    Requires: ELECTRICITY_MAPS_API_KEY set in environment.
    Zone default: US-MIDA-PJM (US mid-Atlantic, close to many university
    data center locations). Adjust as needed.
    """
    api_key = os.environ.get("ELECTRICITY_MAPS_API_KEY")
    if not api_key:
        return None

    try:
        import urllib.request
        import json as _json

        url = (
            f"https://api.electricitymap.org/v3/carbon-intensity/history"
            f"?zone={zone}&datetime={dt.strftime('%Y-%m-%dT%H:00:00.000Z')}"
        )
        req = urllib.request.Request(url, headers={"auth-token": api_key})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = _json.loads(resp.read())
            history = data.get("history", [])
            if history:
                return float(history[-1].get("carbonIntensity", 0))
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# Power and energy model (FR-SC-2)
# ---------------------------------------------------------------------------

def calculate_power_w(utilization_pct: float) -> float:
    """Power (W) = P_idle + (P_max - P_idle) × (utilization / 100).
    Clamps utilization to [0, 100]. MODELLED ESTIMATE."""
    utilization_frac = max(0.0, min(1.0, utilization_pct / 100.0))
    return P_IDLE_W + (P_MAX_W - P_IDLE_W) * utilization_frac


def calculate_energy_kwh(utilization_pct: float, interval_hours: float = INTERVAL_HOURS) -> float:
    """Energy (kWh) = Power × PUE × interval_hours / 1000. MODELLED ESTIMATE."""
    power_w = calculate_power_w(utilization_pct)
    return (power_w * PUE * interval_hours) / 1000.0


def calculate_carbon_gco2(energy_kwh: float, carbon_intensity: float) -> float:
    """Carbon (gCO2) = Energy (kWh) × carbon_intensity (gCO2/kWh). MODELLED ESTIMATE."""
    return energy_kwh * carbon_intensity


# ---------------------------------------------------------------------------
# Convenience aggregators used by the scheduler and predict.py
# ---------------------------------------------------------------------------

def get_baseline_metrics(dt: datetime) -> dict:
    """Static-provisioning baseline metrics for one 5-min interval.
    All values are MODELLED ESTIMATES (100% provisioned, no optimization)."""
    ci = get_carbon_intensity(dt)
    energy = calculate_energy_kwh(BASELINE_UTILIZATION)
    carbon = calculate_carbon_gco2(energy, ci)
    return {
        "baselineEnergyKwh": round(energy, 6),
        "baselineCarbonGco2": round(carbon, 4),
        "baselineCarbonIntensity": round(ci, 2),
        "is_modelled_estimate": True,
    }


def get_aura_metrics(utilization_pct: float, dt: datetime) -> dict:
    """AURA metrics for one 5-min interval at the given utilization.
    All values are MODELLED ESTIMATES."""
    ci = get_carbon_intensity(dt)
    energy = calculate_energy_kwh(utilization_pct)
    carbon = calculate_carbon_gco2(energy, ci)
    return {
        "energyKwh": round(energy, 6),
        "carbonIntensity": round(ci, 2),
        "carbonGco2": round(carbon, 4),
        "is_modelled_estimate": True,
    }


# ---------------------------------------------------------------------------
# Smoke test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    from datetime import timezone

    now = datetime.now(tz=timezone.utc)
    print(f"\nCarbon model smoke test — {now.strftime('%Y-%m-%dT%H:%M UTC')}")
    print("=" * 50)
    print(f"  Carbon intensity (static profile): {get_carbon_intensity(now):.1f} gCO2/kWh")
    print(f"  Power @ 0%:   {calculate_power_w(0):.1f} W  (P_idle={P_IDLE_W} W)")
    print(f"  Power @ 50%:  {calculate_power_w(50):.1f} W")
    print(f"  Power @ 100%: {calculate_power_w(100):.1f} W  (P_max={P_MAX_W} W, PUE={PUE})")

    aura = get_aura_metrics(62.3, now)
    baseline = get_baseline_metrics(now)
    print(f"\n  AURA    @ 62.3%: energy={aura['energyKwh']:.6f} kWh, "
          f"carbon={aura['carbonGco2']:.4f} gCO2  [modelled]")
    print(f"  Baseline @ 100%: energy={baseline['baselineEnergyKwh']:.6f} kWh, "
          f"carbon={baseline['baselineCarbonGco2']:.4f} gCO2  [modelled]")
    print("\n  All values are MODELLED ESTIMATES — see module docstring.")
    print("  Smoke test PASSED.")
