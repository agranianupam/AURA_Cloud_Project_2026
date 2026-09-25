# AURA ΓÇö Dataset Description

## Source: Azure Public Dataset V2 (real data)

**Official source**: [Azure Public Dataset V2](https://github.com/Azure/AzurePublicDataset)
**Paper**: Cortez et al., "Resource Central: Understanding and Predicting Workloads for
Improved Resource Management in Large Cloud Platforms", SOSP 2017.

The dataset contains real VM CPU utilization traces collected from Microsoft Azure's
production infrastructure: 5-minute average/min/max CPU usage readings across the
real VM fleet over the trace's duration.

**This project trains on the real telemetry values from this dataset** ΓÇö not a
synthetic generator. Earlier project drafts used a statistically-similar synthetic
stand-in (documented below, under "What changed"); that has been replaced.

---

## How the real data was obtained and why it's shaped the way it is

Azure V2 ships as 195 files (`vm_cpu_readings-file-N-of-195.csv.gz`, ~850MB each,
~167GB total for all 195), downloaded from the dataset's official GitHub release:
`https://github.com/Azure/AzurePublicDataset/releases/download/dataset-v2/`.

**Important structural fact, confirmed by direct inspection**: each file is a
*time-shard across the entire VM fleet*, not a per-VM shard across the full trace
duration. File 1 contains exactly 45 distinct timestamps (0sΓÇô13,200s, i.e. one
real contiguous **3.75-hour** window), with ~222,000ΓÇô241,000 distinct real VMs
reporting readings within that window (10,000,000 rows / file). Getting one VM's
readings across the *entire* ~30-day trace would require downloading all 195 files
(~167GB) ΓÇö confirmed impractical for this course project: a background download of
just 6 more files was killed by the OS under memory pressure after 2 files, and
local disk had only ~25GB free at the time.

**What we did instead**: extracted a real **VM panel** from file 1 ΓÇö every VM with
a complete 45/45-timestamp record in that shard, sampled down (seed=42) to 3,000
VMs for a manageably-sized, reproducible dataset:

```
dataset/raw/azure_real_vm_panel.csv   ΓÇö 135,000 real rows (3,000 VMs x 45 real ticks)
  columns: vm_id, timestamp (trace-relative seconds), utilization (real avg CPU %)
```

This is a **panel of real, independent short time series** (one per VM), not one
long series ΓÇö a standard multi-series forecasting setup. No synthetic values, no
interpolation, no fabricated timestamps anywhere in this file.

A supplementary real fleet-aggregate series (mean CPU across the full ~227K-VM
fleet per real timestamp, from files 1ΓÇô2) is also kept at
`dataset/raw/azure_real_fleet_cpu_chunks.csv` (90 real points, ~7.5h) as an extra
real artifact ΓÇö not used for model training, since 90 points is too short to give
the LSTM a meaningful training set on its own.

---

## Preprocessing

Implemented in [`src/ml_model/preprocessing/preprocess.py`](../src/ml_model/preprocessing/preprocess.py).

1. **Load**: `dataset/raw/azure_real_vm_panel.csv`.
2. **Split ΓÇö chronological, per VM** (70/15/15): for each VM's own 45 real ticks,
   the first 70% go to train, next 15% to val, last 15% to test. A VM's val/test
   ticks are always strictly later in real time than its own train ticks (no
   leakage). We do **not** split by disjoint VM identity (e.g. VM A entirely in
   train, VM B entirely in test) ΓÇö each VM was only observed for this one real
   3.75h window, so a VM held out entirely for test would have zero real history
   to build a prediction window from.
3. **Normalise**: `MinMaxScaler` fit on train utilization only, applied to all
   splits.
4. **Window** ([`preprocessing/windowing.py`](../src/ml_model/preprocessing/windowing.py)):
   sliding windows of `N_STEPS=6` (30 minutes of real 5-minute readings) predicting
   the next reading, built **per VM** ΓÇö a window never crosses a VM boundary
   (this is checked in code, not just assumed; the original synthetic-data
   pipeline's flat sliding-window function would silently mix two different VMs'
   traces at each boundary if applied naively to concatenated panel data).

### Why `N_STEPS=6`, not the original spec's `N_STEPS=24`

The original build spec assumed one long continuous calendar-indexed series, where
`N_STEPS=24` (2 hours of context) was a reasonable design choice against ~75,000
rows. Real per-VM sequences here are only 45 ticks long (3.75h). With `N_STEPS=24`
and a 70/15/15 split, val/test per VM would have only 6ΓÇô7 ticks ΓÇö not enough to
build even one window of size 24. `N_STEPS=6` (30 min context) is sized to what
the real data actually supports, while still leaving every split with real,
non-trivial row counts (93,000 / 18,000 / 24,000 real rows).

### Why baselines changed from Holt-Winters to non-seasonal SES

The original synthetic pipeline used seasonal Holt-Winters exponential smoothing,
which needs a repeating cycle to decompose. A single 30-minute real window has no
seasonal cycle to find. `src/ml_model/baselines.py` now uses non-seasonal simple
exponential smoothing (SES) ΓÇö the correct degenerate case ΓÇö plus naive persistence
and simple moving average, all evaluated on the identical VM-safe windows the LSTM
sees, for an apples-to-apples comparison.

---

## Results (real data, current run)

| Model | RMSE | MAE | R┬▓ |
|---|---|---|---|
| Naive persistence | 5.215 | 2.049 | 0.851 |
| Simple moving average | 5.339 | 1.935 | 0.844 |
| Simple exponential smoothing | 5.060 | 1.924 | 0.860 |
| **LSTM (2-layer, 64ΓåÆ32)** | **4.521** | **1.635** | **0.888** |

LSTM beats all three baselines on RMSE, MAE, and R┬▓ ΓÇö acceptance criterion met,
entirely on real Azure telemetry. See `results/metrics_comparison.csv` and
`results/lstm_training_history.png` / `results/metrics_comparison.png`.

---

## Academic-calendar demand multiplier ΓÇö status: not applied to training data

Earlier drafts of this project applied a synthetic academic-calendar multiplier
(exam weeks 1.4x, semester start 1.3x, weekends 0.7x, etc.) directly to the
training series. That multiplier is dropped from the real-data training pipeline:
our real base signal spans one real 3.75-hour window with no calendar structure to
multiply against (Azure's trace timestamps are anonymized relative offsets, not
real calendar dates ΓÇö there is no real "which weekday/month was this" to anchor
the multiplier to). Applying it anyway would mean fabricating calendar labels for
real values, which is worse than not applying it at all.

The multiplier remains a documented, disclosed **modeling assumption** about how a
real university data center's demand would additionally vary by academic
calendar ΓÇö it is not derived from any real university server log (no such public
dataset exists), and this project's contribution rests on the hypothesis that real
multipliers would follow a similar shape. It can still be applied at *serving
time* (scaling-decision simulation) rather than baked into ground-truth training
data ΓÇö see `src/ml_model/predict.py`'s scaling-recommendation logic for where a
calendar-aware policy layer would plug in.

---

## What changed from the original (synthetic) draft

The project's first draft used a synthetic Azure-like generator
(`_generate_synthetic_azure_like` in an earlier version of `preprocess.py`) ΓÇö a
sine-wave diurnal curve plus Gaussian noise, seeded, `random.seed(42)` ΓÇö because no
real raw CSV had been placed in `dataset/raw/`. That generator, and the synthetic
75,000-row train/val/test split it produced, have been fully replaced by the real
pipeline described above. The dashboard mock JSON
(`src/ml_model/mock_data/*.json`) is unaffected by this change ΓÇö it remains a
synthetic placeholder by design, documented in its own module docstring
(`mock_seeder.py`), used only to unblock frontend/backend development before the
real API integration lands (Sprint 3).

---

## Reproducing the real dataset

```bash
# 1. Download + extract the real VM panel (downloads one ~850MB Azure V2
#    time-shard, extracts dataset/raw/azure_real_vm_panel.csv +
#    azure_real_fleet_aggregate.csv, then deletes the raw download):
python src/ml_model/preprocessing/extract_real_panel.py

# 2. Run the preprocessing pipeline (splits, normalises)
python src/ml_model/preprocessing/preprocess.py

# 3. Run baselines, then train the LSTM
python src/ml_model/baselines.py
python src/ml_model/lstm_model.py
```

---

## References

1. Cortez, P., Rio, M., Rocha, M., & Abreu, P. (2017). *Resource Central: Understanding
   and Predicting Workloads for Improved Resource Management in Large Cloud
   Platforms.* ACM SOSP.
2. Microsoft Azure. (2019). *Azure Public Dataset V2.*
   https://github.com/Azure/AzurePublicDataset
3. Hochreiter, S., & Schmidhuber, J. (1997). Long short-term memory. *Neural
   Computation, 9*(8), 1735ΓÇô1780.
