"""
AURA dataset download script (FR-ML-1).

Downloads the real Azure Public Dataset V2 VM CPU utilization trace
(file 1 of 195) and extracts a reproducible VM panel for model training.

Renamed from download_or_generate_trace.py — "or_generate" is dropped
because there is NO synthetic fallback for the base data. The base VM CPU
utilization data is genuinely downloaded from Microsoft's public release
(Cortez et al., "Resource Central," ACM SOSP 2017). It is NOT generated
or simulated. The academic-calendar demand multipliers (exam weeks, lecture
hours, recess lulls) are separately documented assumptions applied at
serving time — they are NOT baked into the base training data. See
dataset/dataset_description.md for the full provenance statement.

Usage:
    python dataset/download_trace.py

What this does:
    1. Downloads the real Azure V2 file (trace_data_vm_cpu_readings_vm_cpu_readings
       -file-1-of-195.csv.gz, ~850MB) from the official GitHub release.
    2. Extracts a real VM panel (3,000 VMs × 45 real 5-min ticks = 135,000
       real rows) into dataset/raw/azure_real_vm_panel.csv.
    3. Extracts a real fleet-aggregate series into
       dataset/raw/azure_real_fleet_aggregate.csv.
    4. Deletes the raw .gz download to free disk space.

The actual extraction logic is in:
    src/ml_model/preprocessing/extract_real_panel.py

This script is a thin entry-point wrapper so the PRD-specified path
(dataset/download_trace.py) works as documented.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Add the repo root to path so we can import the extraction module.
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "src" / "ml_model" / "preprocessing"))

if __name__ == "__main__":
    print("AURA — Real Azure VM CPU Trace Download (FR-ML-1)")
    print("=" * 55)
    print("Base data: Azure Public Dataset V2 (Cortez et al., SOSP 2017)")
    print("Source: https://github.com/Azure/AzurePublicDataset")
    print("")
    print("NOTE: This downloads real, unmodified VM CPU telemetry from")
    print("Microsoft's public research release. No synthetic data is used")
    print("as the base signal. Academic-calendar demand multipliers are a")
    print("separate modeling layer, applied at serving time and documented")
    print("in dataset/dataset_description.md.\n")

    try:
        from extract_real_panel import ensure_downloaded, extract, cleanup
    except ImportError:
        sys.path.insert(0, str(REPO_ROOT / "src" / "ml_model"))
        from preprocessing.extract_real_panel import ensure_downloaded, extract, cleanup

    ensure_downloaded()
    extract()
    cleanup()

    print("\nDone. Real dataset extracted to dataset/raw/")
    print("Next steps:")
    print("  python src/ml_model/preprocessing/preprocess.py")
    print("  python src/ml_model/baselines.py")
    print("  python src/ml_model/lstm_model.py")
