"""
Extract a real, reproducible subset from the Azure Public Dataset V2 VM CPU
readings for AURA's training data.

Downloads ONE time-shard file (file 1 of 195: trace-relative seconds
0-13200, i.e. one real contiguous ~3.75h window across the full VM
fleet - see dataset/dataset_description.md for why one file only), then
extracts:
  - dataset/raw/azure_real_vm_panel.csv       - VMs with complete 45/45
    real timestamp coverage, sampled down to MAX_VMS (seed=42)
  - dataset/raw/azure_real_fleet_aggregate.csv - real fleet-mean CPU per
    real timestamp (bonus artifact, not used for training - see docs)

Reads the .gz stream directly (no decompressed copy ever hits disk) and
deletes the downloaded .gz once done, to keep local disk usage minimal.
Idempotent: skips the download if the .gz is already present locally.

Usage: python src/ml_model/preprocessing/extract_real_panel.py
"""
from __future__ import annotations

import csv
import gzip
import os
import random
import urllib.request
from collections import defaultdict
from pathlib import Path

random.seed(42)

FILE_URL = (
    "https://github.com/Azure/AzurePublicDataset/releases/download/"
    "dataset-v2/trace_data_vm_cpu_readings_vm_cpu_readings-file-1-of-195.csv.gz"
)

ROOT = Path(__file__).resolve().parents[3]
RAW_DIR = ROOT / "dataset" / "raw"
DOWNLOAD_DIR = RAW_DIR / "_azure_download"
GZ_PATH = DOWNLOAD_DIR / "vm_cpu_readings-1.csv.gz"

OUT_PANEL = RAW_DIR / "azure_real_vm_panel.csv"
OUT_FLEET = RAW_DIR / "azure_real_fleet_aggregate.csv"

MAX_VMS = 3000  # cap for a manageable, reproducible committed CSV


def ensure_downloaded() -> None:
    if GZ_PATH.exists():
        print(f"Already downloaded: {GZ_PATH}")
        return
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Downloading real Azure VM CPU readings (~850MB) from:\n  {FILE_URL}")
    urllib.request.urlretrieve(FILE_URL, GZ_PATH)
    print(f"Downloaded -> {GZ_PATH}")


def extract() -> None:
    print("\nPass 1: reading all rows, grouping by vm_id ...")
    vm_readings: dict[str, dict[int, float]] = defaultdict(dict)
    timestamps: set[int] = set()
    fleet_sum: dict[int, float] = defaultdict(float)
    fleet_count: dict[int, int] = defaultdict(int)

    with gzip.open(GZ_PATH, "rt", encoding="utf-8") as f:
        reader = csv.reader(f)
        n = 0
        for row in reader:
            ts, vmid, mincpu, maxcpu, avgcpu = row
            ts = int(ts)
            avgcpu = float(avgcpu)
            timestamps.add(ts)
            vm_readings[vmid][ts] = avgcpu
            fleet_sum[ts] += avgcpu
            fleet_count[ts] += 1
            n += 1
            if n % 2_000_000 == 0:
                print(f"  {n:,} rows processed, {len(vm_readings):,} distinct VMs so far")

    print(f"Done: {n:,} rows, {len(vm_readings):,} distinct VMs, {len(timestamps)} distinct timestamps")

    all_ts_sorted = sorted(timestamps)
    n_ts = len(all_ts_sorted)
    print(f"Timestamp range: {all_ts_sorted[0]}s - {all_ts_sorted[-1]}s ({n_ts} ticks)")

    print("\nPass 2: finding VMs with complete coverage (all timestamps present) ...")
    complete_vms = [vmid for vmid, readings in vm_readings.items() if len(readings) == n_ts]
    print(f"Complete VMs: {len(complete_vms):,} / {len(vm_readings):,}")

    if len(complete_vms) > MAX_VMS:
        complete_vms = sorted(complete_vms)
        random.shuffle(complete_vms)
        complete_vms = complete_vms[:MAX_VMS]
    print(f"Sampled down to {len(complete_vms):,} VMs (seed=42)")

    RAW_DIR.mkdir(parents=True, exist_ok=True)

    print(f"\nWriting real VM panel -> {OUT_PANEL}")
    with open(OUT_PANEL, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["vm_id", "timestamp", "utilization"])
        rows_written = 0
        for vmid in complete_vms:
            readings = vm_readings[vmid]
            for ts in all_ts_sorted:
                writer.writerow([vmid, ts, round(readings[ts], 4)])
                rows_written += 1
    print(f"  {rows_written:,} real rows written ({len(complete_vms):,} VMs x {n_ts} ticks)")

    print(f"\nWriting real fleet-aggregate series -> {OUT_FLEET}")
    with open(OUT_FLEET, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["file_idx", "raw_timestamp", "utilization", "n_vms"])
        for ts in all_ts_sorted:
            mean_util = fleet_sum[ts] / fleet_count[ts]
            writer.writerow([1, ts, round(mean_util, 4), fleet_count[ts]])
    print(f"  {n_ts} real fleet-aggregate rows written")


def cleanup() -> None:
    if GZ_PATH.exists():
        os.remove(GZ_PATH)
        print(f"\nDeleted {GZ_PATH} to free disk space (real subset already extracted).")


if __name__ == "__main__":
    ensure_downloaded()
    extract()
    cleanup()
    print("\nDone. Next: python src/ml_model/preprocessing/preprocess.py")
