"""
Carbon-aware scheduler package for AURA.

File ownership: src/ml_model/scheduler/ (Agrani Anupam — AI/ML track).
The thin Lambda wrapper that invokes this logic lives separately at
src/aws/lambda/scaling-handler/ (Prakul Jain — Backend track).

Modules:
    carbon_model  — Power model, energy/carbon estimation, grid CI signal (FR-SC-1/2)
    scheduler     — Workload classification and deferral logic (FR-SC-3/4/5)
"""
from .carbon_model import (
    get_carbon_intensity,
    get_aura_metrics,
    get_baseline_metrics,
    calculate_power_w,
    calculate_energy_kwh,
    calculate_carbon_gco2,
    P_IDLE_W,
    P_MAX_W,
    PUE,
    INTERVAL_HOURS,
)
from .scheduler import (
    Workload,
    SchedulingDecision,
    BaselineComparisonResult,
    schedule_workload,
    compute_baseline_comparison,
    DEFERRABLE_TYPES,
    NON_DEFERRABLE_TYPES,
    CLEAN_GRID_THRESHOLD,
)

__all__ = [
    # carbon_model
    "get_carbon_intensity",
    "get_aura_metrics",
    "get_baseline_metrics",
    "calculate_power_w",
    "calculate_energy_kwh",
    "calculate_carbon_gco2",
    "P_IDLE_W",
    "P_MAX_W",
    "PUE",
    "INTERVAL_HOURS",
    # scheduler
    "Workload",
    "SchedulingDecision",
    "BaselineComparisonResult",
    "schedule_workload",
    "compute_baseline_comparison",
    "DEFERRABLE_TYPES",
    "NON_DEFERRABLE_TYPES",
    "CLEAN_GRID_THRESHOLD",
]
