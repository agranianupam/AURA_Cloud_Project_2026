"""Train an LSTM that forecasts whole-building power demand from the preprocessed CU-BEMS data.

Inputs per forecast:
  past   - the last LOOKBACK steps of load, temperature and calendar features (LSTM encoder)
  future - what is already known about the next HORIZON steps: hour, weekday, weekend/holiday
           flags and the load one week earlier at the same time
Output: total_kw for each of the next HORIZON steps.

The test set is compared against a seasonal-naive baseline (same hours one week earlier).
Hyper-parameters should be chosen on validation MAE; the test numbers are reported once.

Colab:  !pip install holidays
        !python train_lstm.py --data cubems_building_15min.csv --out artifacts
Local:  python src/ml_model/train_lstm.py --data dataset/processed/cubems_building_15min.csv --out results/model
"""
import argparse
import json
import os

import joblib
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import tensorflow as tf
from sklearn.preprocessing import MinMaxScaler

from features import FUTURE_FEATURES, PAST_FEATURES, TARGET, build_features, scale_features, steps_per_week

def make_windows(past, future, target, valid, lookback, horizon):
    """Sliding windows that never span a gap (valid=False anywhere inside the window)."""
    Xp, Xf, y, idx = [], [], [], []
    bad = np.concatenate([[0], np.cumsum(~valid)])
    for start in range(len(past) - lookback - horizon + 1):
        t0, end = start + lookback, start + lookback + horizon
        if bad[end] - bad[start] == 0:
            Xp.append(past[start:t0])
            Xf.append(future[t0:end])
            y.append(target[t0:end])
            idx.append(t0)
    as32 = lambda a: np.array(a, dtype="float32")
    return as32(Xp), as32(Xf), as32(y), np.array(idx)

def build_model(lookback, horizon, n_past, n_future, units, dropout):
    past_in = tf.keras.Input(shape=(lookback, n_past), name="past")
    future_in = tf.keras.Input(shape=(horizon, n_future), name="future")
    h = tf.keras.layers.LSTM(units, return_sequences=True)(past_in)
    h = tf.keras.layers.Dropout(dropout)(h)
    h = tf.keras.layers.LSTM(units // 2)(h)
    f = tf.keras.layers.Flatten()(future_in)
    z = tf.keras.layers.Concatenate()([h, f])
    z = tf.keras.layers.Dense(128, activation="relu")(z)
    z = tf.keras.layers.Dropout(dropout)(z)
    out = tf.keras.layers.Dense(horizon, name="total_kw")(z)
    return tf.keras.Model([past_in, future_in], out)

def metrics(y_true, y_pred):
    err = y_pred - y_true
    return {
        "mae_kw": float(np.mean(np.abs(err))),
        "rmse_kw": float(np.sqrt(np.mean(err ** 2))),
        "mape_pct": float(np.mean(np.abs(err) / np.maximum(np.abs(y_true), 1e-3)) * 100),
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", default="artifacts")
    ap.add_argument("--freq", default="1h")
    ap.add_argument("--lookback-days", type=float, default=7)
    ap.add_argument("--horizon-hours", type=float, default=24)
    ap.add_argument("--units", type=int, default=128)
    ap.add_argument("--dropout", type=float, default=0.2)
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--batch", type=int, default=64)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    tf.keras.utils.set_random_seed(42)

    raw = pd.read_csv(args.data, parse_dates=["timestamp"], index_col="timestamp")
    df = build_features(raw, args.freq)
    step = pd.Timedelta(args.freq)
    lookback = int(pd.Timedelta(days=args.lookback_days) / step)
    horizon = int(pd.Timedelta(hours=args.horizon_hours) / step)
    week = steps_per_week(args.freq)
    cols = sorted(set(PAST_FEATURES) | set(FUTURE_FEATURES))
    valid = df[cols].notna().all(axis=1).to_numpy()

    n = len(df)
    cut1, cut2 = int(n * 0.70), int(n * 0.85)
    train = df.iloc[:cut1]
    kw_scaler = MinMaxScaler().fit(train[[TARGET]].dropna())
    other = [c for c in cols if c not in (TARGET, "kw_lag_week")]
    other_scaler = MinMaxScaler().fit(train[other].dropna())
    scaled = scale_features(df, kw_scaler, other_scaler, other)

    Xp, Xf, y, idx = make_windows(
        scaled[PAST_FEATURES].to_numpy("float32"), scaled[FUTURE_FEATURES].to_numpy("float32"),
        scaled[TARGET].to_numpy("float32"), valid, lookback, horizon,
    )
    tr, va, te = idx < cut1, (idx >= cut1) & (idx < cut2), idx >= cut2
    print(f"steps={n} lookback={lookback} horizon={horizon} windows: train={tr.sum()} val={va.sum()} test={te.sum()}")

    model = build_model(lookback, horizon, len(PAST_FEATURES), len(FUTURE_FEATURES), args.units, args.dropout)
    model.compile(optimizer=tf.keras.optimizers.Adam(1e-3), loss="mse", metrics=["mae"])
    model.summary()
    history = model.fit(
        [Xp[tr], Xf[tr]], y[tr],
        validation_data=([Xp[va], Xf[va]], y[va]),
        epochs=args.epochs, batch_size=args.batch,
        callbacks=[
            tf.keras.callbacks.EarlyStopping(patience=8, restore_best_weights=True),
            tf.keras.callbacks.ReduceLROnPlateau(patience=4, factor=0.5),
        ],
        verbose=2,
    )

    unscale = lambda a: kw_scaler.inverse_transform(a.reshape(-1, 1)).reshape(a.shape)
    kw = df[TARGET].to_numpy()
    lag = df["kw_lag_week"].to_numpy()

    def evaluate(mask):
        y_true = unscale(y[mask])
        y_pred = unscale(model.predict([Xp[mask], Xf[mask]], verbose=0))
        naive = np.array([lag[i:i + horizon] for i in idx[mask]])
        assert np.allclose(y_true, np.array([kw[i:i + horizon] for i in idx[mask]]), atol=1e-2)
        return y_true, y_pred, {"lstm": metrics(y_true, y_pred), "seasonal_naive_week": metrics(y_true, naive)}

    _, _, val_metrics = evaluate(va)
    y_test, y_pred, test_metrics = evaluate(te)
    results = {
        "validation": val_metrics,
        "test": test_metrics,
        "config": vars(args) | {
            "lookback_steps": lookback, "horizon_steps": horizon,
            "past_features": PAST_FEATURES, "future_features": FUTURE_FEATURES,
            "epochs_run": len(history.history["loss"]),
        },
        "periods": {
            "train": [str(df.index[0]), str(df.index[cut1 - 1])],
            "validation": [str(df.index[cut1]), str(df.index[cut2 - 1])],
            "test": [str(df.index[idx[te][0]]), str(df.index[idx[te][-1] + horizon - 1])],
        },
        "windows": {"train": int(tr.sum()), "validation": int(va.sum()), "test": int(te.sum())},
    }
    print(json.dumps({k: results[k] for k in ("validation", "test")}, indent=2))

    model.save(os.path.join(args.out, "aura_lstm.keras"))
    joblib.dump(
        {"kw_scaler": kw_scaler, "other_scaler": other_scaler, "other_columns": other,
         "freq": args.freq, "lookback": lookback, "horizon": horizon},
        os.path.join(args.out, "scaler.joblib"),
    )
    with open(os.path.join(args.out, "metrics.json"), "w") as f:
        json.dump(results, f, indent=2)

    fig, axes = plt.subplots(2, 1, figsize=(12, 8))
    axes[0].plot(history.history["loss"], label="train")
    axes[0].plot(history.history["val_loss"], label="validation")
    axes[0].set(title="Training loss (MSE, scaled)", xlabel="epoch")
    axes[0].legend()
    t_list, a_list, p_list = [], [], []
    for k, i in enumerate(idx[te]):
        if k % horizon:
            continue
        t_list.append(df.index[i:i + horizon])
        a_list.append(np.append(y_test[k], np.nan))
        p_list.append(np.append(y_pred[k], np.nan))
        t_list[-1] = t_list[-1].append(pd.DatetimeIndex([df.index[i + horizon - 1] + step / 2]))
    t_axis = np.concatenate(t_list)
    axes[1].plot(t_axis, np.concatenate(a_list), label="actual", linewidth=1)
    axes[1].plot(t_axis, np.concatenate(p_list), label="LSTM forecast", linewidth=1)
    m = test_metrics
    axes[1].set(
        title=f"Test period, next-{args.horizon_hours:g}h forecasts  |  MAE LSTM {m['lstm']['mae_kw']:.1f} kW"
              f" vs same-hour-last-week {m['seasonal_naive_week']['mae_kw']:.1f} kW",
        ylabel="kW",
    )
    axes[1].legend()
    fig.tight_layout()
    fig.savefig(os.path.join(args.out, "forecast.png"), dpi=120)
    print(f"saved model, scaler, metrics and plot to {args.out}")

if __name__ == "__main__":
    main()
