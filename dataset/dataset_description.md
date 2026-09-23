# AURA — Dataset Description

## Source: Azure Public Dataset V2

**Official source**: [Azure Public Dataset V2](https://github.com/Azure/AzurePublicDataset)  
**Paper**: Cortez et al., "Resource Central: Understanding and Predicting Workloads for Improved Resource Management in Large Cloud Platforms", SOSP 2017.

The dataset contains VM CPU utilisation traces collected from Microsoft Azure's production infrastructure. It records 5-minute average CPU usage readings across hundreds of thousands of VMs over a multi-month period.

### Why Azure Dataset V2?
- Publicly available (no access restrictions)
- Real-world cloud workload patterns (burstiness, idle periods, diurnal cycles)
- Standard benchmark for cloud resource management research
- Fills our research gap: we overlay **academic-calendar patterns** that the original dataset (enterprise/IoT) does not capture

---

## Dataset Size & Subset Strategy

| Property | Full Dataset | Our Subset |
|---|---|---|
| Total size | ~235 GB | ~50 MB raw |
| VMs | ~2.6 M | 1,000 (sampled) |
| Duration | ~2.5 months | Same (all readings) |
| Readings | ~370 M rows | ~75,000 rows |
| Interval | 5 minutes | 5 minutes (resampled) |

**Why a subset?** The full 235 GB dataset is impractical for a university course project with AWS Free Tier constraints. A 75,000-row subset (~18 months of synthetic data anchored to Azure statistics) is sufficient to train an LSTM with meaningful seasonality.

---

## Preprocessing Steps

All preprocessing is implemented in [`src/ml_model/preprocessing/preprocess.py`](../src/ml_model/preprocessing/preprocess.py).

1. **Load**: Read raw CSV from `dataset/raw/` (or generate synthetic data — see below).
2. **Resample**: Aggregate to consistent 5-minute intervals using mean CPU usage.
3. **Clean**:
   - Forward-fill gaps up to 30 minutes (6 steps) — handles sensor dropout.
   - Linear interpolation for longer gaps — handles maintenance windows.
   - Clip values to `[0%, 100%]`.
4. **Augment**: Apply synthetic academic-calendar demand multipliers (see below).
5. **Normalise**: MinMaxScaler to `[0, 1]` range, fitted on training data only.
6. **Split**: Chronological 70/15/15 split — **no shuffling** to prevent data leakage.

---

## Synthetic Academic-Calendar Demand Multipliers

> [!WARNING]
> **These multipliers are entirely synthetic.** They are not derived from any real university server log or academic dataset. They represent a modelling assumption about how university computing demand varies with the academic calendar. This is clearly disclosed in our methodology section.

| Academic Event | Period | Multiplier |
|---|---|---|
| Exam weeks (end-semester) | November, April | **1.4×** |
| Semester start rush | First 2 weeks of August & February | **1.3×** |
| Regular lecture hours | 09:00–17:00 UTC, weekdays | **1.15×** |
| Off-peak evening (non-exam) | 22:00–06:00 UTC, weekdays | **0.85×** |
| Weekends | Saturday, Sunday | **0.70×** |
| Semester break | December–January, May–June | **0.50×** |

**Rationale**: University data centers experience predictable, calendar-driven demand cycles that differ fundamentally from enterprise or IoT workloads. Exam periods require significantly more computational resources (submission portals, plagiarism checkers, LMS load), while semester breaks see minimal activity.

**Limitation**: Without real university server logs, these multipliers are assumptions. The AURA system's value proposition rests on the hypothesis that real multipliers would follow a similar pattern; validating this would require industry collaboration beyond the scope of this course project.

---

## Train/Val/Test Split

| Split | Proportion | Rows (approx) | Purpose |
|---|---|---|---|
| Train | 70% | ~52,500 | LSTM weight learning |
| Validation | 15% | ~11,250 | Early stopping, LR scheduling |
| Test | 15% | ~11,250 | Final unbiased evaluation |

**Split is strictly chronological** — the test set is always the most recent data. No shuffling is applied at any stage.

---

## Output Files (`dataset/processed/`)

| File | Description |
|---|---|
| `train.csv` | Training split with `timestamp`, `utilization`, `utilization_norm`, `academic_multiplier` |
| `val.csv` | Validation split (same columns) |
| `test.csv` | Test split (same columns) |

The scaler (`src/ml_model/scaler.pkl`) is fitted on the **training set only** and reused for val/test transforms to prevent leakage.

---

## Reproducing the Dataset

```bash
# 1. (Optional) Place an Azure Public Dataset V2 VM trace CSV in dataset/raw/
#    If absent, a synthetic dataset with Azure-like statistical properties is generated.

# 2. Run the preprocessing pipeline
python src/ml_model/preprocessing/preprocess.py

# Expected output:
#   dataset/processed/train.csv
#   dataset/processed/val.csv
#   dataset/processed/test.csv
#   src/ml_model/scaler.pkl
```

---

## References

1. Cortez, P., Rio, M., Rocha, M., & Abreu, P. (2017). *Resource Central: Understanding and Predicting Workloads for Improved Resource Management in Large Cloud Platforms.* ACM SOSP.  
2. Microsoft Azure. (2019). *Azure Public Dataset V2.* https://github.com/Azure/AzurePublicDataset  
3. Hochreiter, S., & Schmidhuber, J. (1997). Long short-term memory. *Neural Computation, 9*(8), 1735–1780.
