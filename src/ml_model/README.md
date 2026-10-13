# src/ml_model/
Demand-forecasting model: given the last 7 days of building load, it predicts the next 24 hours of power demand (kW). It is trained on the CU-BEMS dataset (see [dataset/dataset_description.md](../../dataset/dataset_description.md)).

| File | Purpose |
|---|---|
| `download_data.py` | Downloads the 14 CU-BEMS CSVs (788 MB) into `dataset/raw/` |
| `preprocess.py` | Turns 1-minute raw meter data into 15-minute building and per-floor series in `dataset/processed/` |
| `features.py` | Shared features: cyclic hour and weekday, weekend and Thai holiday flags, load one week earlier |
| `train_lstm.py` | Trains the model, evaluates it against a same-hour-last-week baseline, and saves it to `results/model/` |
| `predict.py` | Loads the trained model and writes the next-24h forecast as JSON |

## Model
- **Encoder:** 2-layer LSTM over the past 168 hourly steps (load, temperature, time features, weekend and holiday flags).
- **Future inputs:** what is known about the next 24 hours: time of day, weekday, weekend and holiday flags, and last week's load at the same hour.
- **Head:** dense layers that output the 24 hourly loads.
- **Training:** chronological 70/15/15 train/validation/test split, MSE loss, early stopping on validation. Hyper-parameters are chosen by validation error, so the test period is used only once, for the final numbers.

Results are in [`results/model/metrics.json`](../../results/model/metrics.json) and [`results/model/forecast.png`](../../results/model/forecast.png).

## Run
TensorFlow doesn't support Python 3.14 yet. Use a Python 3.10–3.12 virtual environment.
```bash
python -m pip install -r src/ml_model/requirements.txt
python src/ml_model/download_data.py
python src/ml_model/preprocess.py
python src/ml_model/train_lstm.py --data dataset/processed/cubems_building_15min.csv --out results/model
python src/ml_model/predict.py --data dataset/processed/cubems_building_15min.csv --end "2019-10-14 00:00"
```
On a laptop CPU, training takes about 5 minutes.

To train in Colab instead, upload `cubems_building_15min.csv`, `features.py` and `train_lstm.py`, run `!pip install holidays`, then run the training command with `--out artifacts`.
