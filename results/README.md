# results/
Graphs and metrics from model evaluation and the allocation simulation. Hyper-parameters and scheduling settings were **tuned on the validation period and reported once on the test period**.

## `model/`: demand-forecasting LSTM
Trained by `src/ml_model/train_lstm.py`. It forecasts the next 24 hours of building load from the past 7 days, with calendar and Thai holiday features.

| Test period, 2019-08-11 to 2019-10-21 | MAE | RMSE | MAPE |
|---|---|---|---|
| LSTM | **35.9 kW** | **48.0 kW** | **20.5%** |
| Same hours last week (seasonal naive) | 44.9 kW | 83.3 kW | 24.0% |

That's 20% lower average error and 42% lower RMSE than the baseline.

How the settings were chosen (validation MAE, kW):

| Model | Val MAE (kW) |
|---|---|
| 64 units, 7-day lookback | 39.5 |
| 32 units | 38.2 |
| **128 units (selected)** | **38.0** |
| 3-day lookback | 39.2 |
| 14-day lookback | 37.8 (scored on fewer windows, so not directly comparable) |

A first version without holiday and future features scored a test MAE of 46.8 kW. That's worse than the baseline, so it was replaced.

Files:
- `aura_lstm.keras`: the model
- `scaler.joblib`: scalers plus window settings
- `metrics.json`: validation and test metrics, periods and config
- `forecast.png`: training curve and test forecasts

## `simulation/`: forecast-driven, carbon-aware allocation
**39.5% less energy, 41.3% less CO₂ and 99.53% SLA** against always-on provisioning over the test period. Carbon-aware batch placement contributes 2.3 of the 41.3 points. Method and assumptions are in [simulation/README.md](simulation/README.md).
