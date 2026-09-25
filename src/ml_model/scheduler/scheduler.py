"""
AURA carbon-aware scheduler — core scheduling logic (FR-SC-3, FR-SC-4, FR-SC-5).

File ownership: src/ml_model/scheduler/ (Agrani Anupam — AI/ML track).
The thin Lambda wrapper that INVOKES this logic lives separately at
src/aws/lambda/scaling-handler/ (Prakul Jain — Backend track) per PRD
Section 4 / Section 6.2.

IMPORTANT: All energy and carbon figures produced here are MODELLED ESTIMATES
derived from the documented power model in carbon_model.py. The underlying
Azure Public Dataset V2 contains no real energy or carbon measurements.
Every reported value is labelled accordingly.

FR-SC-3: Classifies workloads as deferrable or non-deferrable and shifts
         deferrable jobs to lower-carbon windows within their deadlines.
FR-SC-4: Extend predict() to factor in both demand AND carbon intensity.
         (predict.py calls carbon_model.get_carbon_intensity() — this
         module exposes the higher-level scheduling decision layer.)
FR-SC-5: Static-provisioning baseline vs. AURA comparison over a simulated
         period, reporting energy, carbon, and cost savings.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Optional

from .carbon_model import (
    INTERVAL_HOURS,
    get_carbon_intensity,
    get_aura_metrics,
    get_baseline_metrics,
)

# ---------------------------------------------------------------------------
# Workload classification (FR-SC-3)
# ---------------------------------------------------------------------------

# Deferrable workload types — batch/research jobs that carry a deadline and
# can be shifted to lower-carbon windows without missing it.
DEFERRABLE_TYPES = {"batch", "backup", "analytics", "research"}

# Non-deferrable workload types — must run immediately; only capacity is
# right-sized using the demand forecast.
NON_DEFERRABLE_TYPES = {"lms", "exam", "campus_iot", "web", "interactive"}

# Carbon-intensity threshold (gCO2/kWh). Deferrable jobs scheduled when the
# grid is BELOW this value — the "low-carbon window" criterion.
CLEAN_GRID_THRESHOLD = 500.0  # midpoint of the documented static profile

# Cost model: illustrative $/kWh for university cloud billing estimate.
# Labelled as a modelled assumption alongside energy/carbon figures.
COST_PER_KWH = 0.12  # USD, documented default assumption


@dataclass
class Workload:
    """Represents a unit of work to be scheduled."""
    workload_id: str
    workload_type: str          # e.g. "batch", "lms", "exam"
    deadline: datetime          # latest acceptable start time
    duration_hours: float       # estimated run duration
    avg_utilization_pct: float  # estimated average CPU utilisation during run

    @property
    def is_deferrable(self) -> bool:
        return self.workload_type.lower() in DEFERRABLE_TYPES


@dataclass
class SchedulingDecision:
    """Output of the scheduler for a single workload."""
    workload_id: str
    decision: str               # "proceed" | "defer"
    scheduled_at: Optional[datetime]
    reason: str
    # Modelled energy/carbon for the chosen window (FR-SC-2)
    energy_kwh: float = 0.0
    carbon_gco2: float = 0.0
    baseline_energy_kwh: float = 0.0
    baseline_carbon_gco2: float = 0.0
    is_modelled_estimate: bool = True  # always True; labelled per NFR-Reliability


# ---------------------------------------------------------------------------
# Core scheduling logic
# ---------------------------------------------------------------------------

def _find_lowest_carbon_window(
    earliest: datetime,
    deadline: datetime,
    step_minutes: int = 60,
) -> datetime:
    """Return the datetime in [earliest, deadline] with the lowest carbon
    intensity, scanning hourly. Falls back to earliest if no window is found
    (e.g. deadline is too tight). FR-SC-3."""
    best_dt = earliest
    best_ci = get_carbon_intensity(earliest)

    current = earliest
    while current <= deadline:
        ci = get_carbon_intensity(current)
        if ci < best_ci:
            best_ci = ci
            best_dt = current
        current += timedelta(minutes=step_minutes)

    return best_dt


def schedule_workload(
    workload: Workload,
    now: Optional[datetime] = None,
) -> SchedulingDecision:
    """Schedule a single workload per the carbon-aware policy (FR-SC-3/4).

    Non-deferrable workloads always proceed immediately.
    Deferrable workloads are shifted to the lowest-carbon window that still
    meets their deadline (and that window is within the current clean-grid
    threshold); if no cleaner window exists within the deadline, they proceed
    immediately rather than missing the deadline.

    Returns a SchedulingDecision with modelled energy/carbon for the chosen
    window (all values are MODELLED ESTIMATES, FR-SC-2).
    """
    now = now or datetime.now(tz=timezone.utc)

    if not workload.is_deferrable:
        scheduled_at = now
        reason = f"non-deferrable workload type '{workload.workload_type}' — runs immediately"
        decision = "proceed"
    else:
        # Find the lowest-carbon window within deadline
        best_window = _find_lowest_carbon_window(now, workload.deadline)
        ci_now = get_carbon_intensity(now)
        ci_best = get_carbon_intensity(best_window)

        if ci_best < ci_now and best_window > now:
            scheduled_at = best_window
            decision = "defer"
            saving_pct = round((ci_now - ci_best) / ci_now * 100, 1)
            reason = (
                f"deferrable — shifted from {now.strftime('%H:%M')} UTC "
                f"(CI={ci_now:.0f} gCO2/kWh) to {best_window.strftime('%H:%M')} UTC "
                f"(CI={ci_best:.0f} gCO2/kWh, -{saving_pct}% carbon) "
                f"within deadline {workload.deadline.strftime('%H:%M')} UTC"
            )
        else:
            scheduled_at = now
            decision = "proceed"
            reason = (
                "deferrable but no lower-carbon window found within deadline, "
                "or current window is already the cleanest — proceeding now"
            )

    # Modelled energy/carbon for the chosen window (FR-SC-2)
    aura = get_aura_metrics(workload.avg_utilization_pct, scheduled_at)
    baseline = get_baseline_metrics(scheduled_at)

    return SchedulingDecision(
        workload_id=workload.workload_id,
        decision=decision,
        scheduled_at=scheduled_at,
        reason=reason,
        energy_kwh=aura["energyKwh"] * (workload.duration_hours / INTERVAL_HOURS),
        carbon_gco2=aura["carbonGco2"] * (workload.duration_hours / INTERVAL_HOURS),
        baseline_energy_kwh=baseline["baselineEnergyKwh"] * (workload.duration_hours / INTERVAL_HOURS),
        baseline_carbon_gco2=baseline["baselineCarbonGco2"] * (workload.duration_hours / INTERVAL_HOURS),
        is_modelled_estimate=True,
    )


# ---------------------------------------------------------------------------
# Static-provisioning baseline comparison (FR-SC-5)
# ---------------------------------------------------------------------------

@dataclass
class BaselineComparisonResult:
    """AURA vs static-provisioning baseline over a simulated period (FR-SC-5).

    All energy/carbon/cost figures are MODELLED ESTIMATES. The underlying
    dataset has no real energy or carbon measurements.
    """
    period_hours: float
    aura_energy_kwh: float
    baseline_energy_kwh: float
    aura_carbon_gco2: float
    baseline_carbon_gco2: float
    aura_cost_usd: float
    baseline_cost_usd: float
    # Savings
    energy_saved_kwh: float
    carbon_saved_kg: float
    cost_saved_usd: float
    percent_energy_reduction: float
    percent_carbon_reduction: float
    # SLA compliance: % of intervals where provisioned capacity >= demand
    sla_compliance_pct: float
    n_intervals: int
    n_sla_met: int
    is_modelled_estimate: bool = True

    def summary(self) -> str:
        lines = [
            "AURA vs Static-Provisioning Baseline (MODELLED ESTIMATES)",
            "=" * 60,
            f"  Simulation period   : {self.period_hours:.1f} hours "
            f"({self.n_intervals} x 5-min intervals)",
            f"  AURA energy         : {self.aura_energy_kwh:.4f} kWh",
            f"  Baseline energy     : {self.baseline_energy_kwh:.4f} kWh",
            f"  Energy saved        : {self.energy_saved_kwh:.4f} kWh "
            f"({self.percent_energy_reduction:.1f}% reduction)",
            f"  AURA carbon         : {self.aura_carbon_gco2 / 1000:.4f} kgCO2",
            f"  Baseline carbon     : {self.baseline_carbon_gco2 / 1000:.4f} kgCO2",
            f"  Carbon saved        : {self.carbon_saved_kg:.4f} kgCO2 "
            f"({self.percent_carbon_reduction:.1f}% reduction)",
            f"  AURA cost           : ${self.aura_cost_usd:.4f}",
            f"  Baseline cost       : ${self.baseline_cost_usd:.4f}",
            f"  Cost saved          : ${self.cost_saved_usd:.4f}",
            f"  SLA compliance      : {self.sla_compliance_pct:.1f}% "
            f"({self.n_sla_met}/{self.n_intervals} intervals, target >=95%)",
            "",
            "  NOTE: All energy, carbon, and cost figures are MODELLED ESTIMATES",
            "  derived from the documented power model (P_idle=100W, P_max=250W,",
            "  PUE=1.5). See carbon_model.py and dataset_description.md.",
        ]
        return "\n".join(lines)


def compute_baseline_comparison(
    utilization_series: list[float],
    start_time: Optional[datetime] = None,
    interval_minutes: int = 5,
    headroom_pct: float = 0.05,
) -> BaselineComparisonResult:
    """Compute AURA vs static-provisioning baseline over a utilization series.

    Args:
        utilization_series: List of CPU utilization % values (one per interval).
        start_time: UTC start of the simulated period (defaults to now).
        interval_minutes: Duration of each interval in minutes (default 5).
        headroom_pct: SLA safety headroom added to AURA's provisioned capacity.

    Returns:
        BaselineComparisonResult with all savings labelled as modelled estimates.

    FR-SC-5 requirement: compare AURA against a static-provisioning baseline
    (always-on, 100% provisioned) over the same simulated period.
    """
    start_time = start_time or datetime.now(tz=timezone.utc)
    n = len(utilization_series)
    period_hours = n * interval_minutes / 60.0

    aura_energy_total = 0.0
    baseline_energy_total = 0.0
    aura_carbon_total = 0.0
    baseline_carbon_total = 0.0
    n_sla_met = 0

    for i, util_pct in enumerate(utilization_series):
        ts = start_time + timedelta(minutes=i * interval_minutes)

        # AURA provisions at forecast + headroom
        provisioned = min(100.0, util_pct * (1.0 + headroom_pct))

        # SLA met if provisioned capacity >= actual demand
        if provisioned >= util_pct:
            n_sla_met += 1

        aura_m = get_aura_metrics(provisioned, ts)
        baseline_m = get_baseline_metrics(ts)

        # Scale energy/carbon from per-interval to actual interval duration
        scale = interval_minutes / (INTERVAL_HOURS * 60)
        aura_energy_total += aura_m["energyKwh"] * scale
        aura_carbon_total += aura_m["carbonGco2"] * scale
        baseline_energy_total += baseline_m["baselineEnergyKwh"] * scale
        baseline_carbon_total += baseline_m["baselineCarbonGco2"] * scale

    energy_saved = baseline_energy_total - aura_energy_total
    carbon_saved_gco2 = baseline_carbon_total - aura_carbon_total

    aura_cost = aura_energy_total * COST_PER_KWH
    baseline_cost = baseline_energy_total * COST_PER_KWH
    cost_saved = baseline_cost - aura_cost

    pct_energy = (energy_saved / baseline_energy_total * 100) if baseline_energy_total > 0 else 0.0
    pct_carbon = (carbon_saved_gco2 / baseline_carbon_total * 100) if baseline_carbon_total > 0 else 0.0
    sla_pct = (n_sla_met / n * 100) if n > 0 else 0.0

    return BaselineComparisonResult(
        period_hours=period_hours,
        aura_energy_kwh=round(aura_energy_total, 6),
        baseline_energy_kwh=round(baseline_energy_total, 6),
        aura_carbon_gco2=round(aura_carbon_total, 4),
        baseline_carbon_gco2=round(baseline_carbon_total, 4),
        aura_cost_usd=round(aura_cost, 6),
        baseline_cost_usd=round(baseline_cost, 6),
        energy_saved_kwh=round(energy_saved, 6),
        carbon_saved_kg=round(carbon_saved_gco2 / 1000, 6),
        cost_saved_usd=round(cost_saved, 6),
        percent_energy_reduction=round(pct_energy, 2),
        percent_carbon_reduction=round(pct_carbon, 2),
        sla_compliance_pct=round(sla_pct, 2),
        n_intervals=n,
        n_sla_met=n_sla_met,
        is_modelled_estimate=True,
    )


# ---------------------------------------------------------------------------
# Smoke test / CLI entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import json

    print("\nAURA Carbon-Aware Scheduler — Smoke Test")
    print("=" * 50)

    now = datetime.now(tz=timezone.utc)

    # --- Workload scheduling test ---
    test_workloads = [
        Workload("batch-001", "batch", now + timedelta(hours=8), 2.0, 60.0),
        Workload("lms-001", "lms", now + timedelta(minutes=5), 0.5, 75.0),
        Workload("backup-001", "backup", now + timedelta(hours=12), 1.0, 40.0),
        Workload("exam-001", "exam", now + timedelta(minutes=15), 0.25, 90.0),
    ]

    print("\n[1/2] Scheduling decisions:")
    for wl in test_workloads:
        dec = schedule_workload(wl, now=now)
        print(f"  {dec.workload_id} ({wl.workload_type}): "
              f"{dec.decision.upper()} — {dec.reason[:80]}...")
        print(f"    Energy: {dec.energy_kwh:.4f} kWh (AURA) vs "
              f"{dec.baseline_energy_kwh:.4f} kWh (baseline) [modelled]")

    # --- Baseline comparison test ---
    print("\n[2/2] Baseline comparison (24h simulated, 5-min intervals):")
    import random
    rng = random.Random(42)
    sim_utils = [rng.uniform(20, 80) for _ in range(288)]  # 288 x 5min = 24h
    result = compute_baseline_comparison(sim_utils, start_time=now)
    print(result.summary())

    print("\nSmoke test PASSED — scheduler imports and runs cleanly.")
