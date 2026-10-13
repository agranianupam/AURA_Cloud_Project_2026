# Dataset description

## CU-BEMS: Smart building electricity consumption and indoor environmental sensor data

| | |
|---|---|
| **Source** | Chulalongkorn University Building Energy Management System (CU-BEMS), Bangkok, Thailand |
| **Data DOI** | https://doi.org/10.6084/m9.figshare.11726517 |
| **Metadata DOI** | https://doi.org/10.6084/m9.figshare.12527219 |
| **Paper** | Pipattanasomporn et al., "CU-BEMS, smart building electricity consumption and indoor environmental sensor datasets", *Scientific Data* 7, 241 (2020) |
| **License** | CC BY 4.0 |
| **Size** | 14 CSV files, 788 MB (one per floor per year) |
| **Records** | 5,432,489 rows at 1-minute resolution |
| **Period** | 2018-07-01 to 2019-12-31 |
| **Data type** | Multivariate time series, tabular (CSV) |

### Why this dataset
It is real metered data from a university building, so it shows the academic demand cycles AURA targets: weekday/weekend patterns, public holidays and term breaks. AURA uses it as a stand-in for campus data-center and building load when forecasting demand and scheduling resources.

### Files and columns
`dataset/raw/<year>Floor<n>.csv`, with `<year>` 2018 or 2019 and `<n>` from 1 to 7. These files are not committed (see below for how to download them).

Each file has a `Date` column (`YYYY-MM-DD HH:MM:SS`) followed by one column per meter or sensor, named `z<zone>_<device>`:

| Pattern | Meaning | Unit |
|---|---|---|
| `z?_AC?(kW)` | air-conditioning unit power | kW |
| `z?_Light(kW)` | lighting power | kW |
| `z?_Plug(kW)` | plug-load power | kW |
| `z?_S1(degC)` | indoor temperature | °C |
| `z?_S1(RH%)` | relative humidity | % |
| `z?_S1(lux)` | ambient light | lux |

Floor 1 has 12 columns (power only, no sensors). Floor 2 has 37 (14 AC units in zone 2). Floors 3 to 7 have 30.

### Known data issues
- `2019Floor6.csv` ends at 2019-10-22 13:27, and its last row is cut off. This is the same in the published file.
- Missing values: 2018 floors 2–7 have 23–39% blank cells, mostly in the sensor columns. 2019 has 0.1–13%.
- Floor 3 has a gap of about 40 days with no power data.

### Preprocessing (`src/ml_model/preprocess.py`)
1. Parse timestamps, drop unparseable or duplicate rows, and join 2018 and 2019 for each floor.
2. For each floor, sum the kW meters into `total_kw`, `ac_kw`, `light_kw` and `plug_kw`, and average the temperature, humidity and lux sensors.
3. Resample to 15-minute means and linearly interpolate gaps of up to 1 hour. Longer gaps stay empty.
4. Building total: sum the 7 floors, keeping only time steps where every floor has data, so a missing floor never looks like low demand.
5. Add calendar columns (hour, weekday, month, weekend).

Outputs in `dataset/processed/`:

| File | Rows | Content |
|---|---|---|
| `cubems_building_15min.csv` | 41,766 | whole-building load + environment + calendar, 2018-07-01 to 2019-10-22 |
| `cubems_floors_15min.csv` | 362,166 | the same per floor (`floor` column) |
| `preprocess_report.txt` | – | coverage and gaps for each floor |
| `carbon_hourly.csv` | 3,481 | `ts` (UTC), `gco2_per_kwh`: hourly UK grid carbon intensity, 2019-05-31 to 2019-10-23, from the [Carbon Intensity API](https://carbonintensity.org.uk) (CC BY 4.0) via `fetch_carbon.py`. Uses the actual value, or the API forecast when no actual exists (154 of 6,972 half-hours). Real grid data, but the UK grid, not Thailand's. |
| `forecast_hourly.csv` | 1,704 | `ts` (Bangkok local time), `actual_kwh`, `forecast_kwh`: day-ahead LSTM backtest over the test period (2019-08-12 to 2019-10-21), each day forecast at local midnight from earlier data only. Building load in kW averaged over an hour equals kWh for that hour. Written by `simulate.py`. |

The model (`src/ml_model/features.py`) also resamples to 1 hour and adds cyclic time features, Thai public-holiday flags (`holidays` package) and the load from one week earlier.

### Reproducing
```bash
python src/ml_model/download_data.py
python src/ml_model/preprocess.py
```
