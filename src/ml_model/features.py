"""Feature engineering shared by train_lstm.py and predict.py."""
import holidays
import numpy as np
import pandas as pd

TARGET = "total_kw"
# Fed to the LSTM encoder for each step of the lookback window
PAST_FEATURES = [TARGET, "temp_c", "hour_sin", "hour_cos", "dow_sin", "dow_cos", "is_weekend", "is_holiday"]
# Known in advance for each step of the forecast horizon
FUTURE_FEATURES = [
    "hour_sin", "hour_cos", "dow_sin", "dow_cos", "is_weekend", "is_holiday",
    "kw_lag_week", "lag_week_was_holiday",
]


def steps_per_week(freq):
    return int(pd.Timedelta(days=7) / pd.Timedelta(freq))


def holiday_flags(index):
    """1.0 on Thai public holidays (CU-BEMS is a Chulalongkorn University building in Bangkok)."""
    th = holidays.Thailand(years=sorted(set(index.year)))
    return np.array([d in th for d in index.date], dtype="float32")


def scale_features(df, kw_scaler, other_scaler, other_columns):
    """Load columns (total_kw and its weekly lag) share one scaler; everything else uses the other."""
    scaled = pd.DataFrame(index=df.index)
    for c in (TARGET, "kw_lag_week"):
        scaled[c] = kw_scaler.transform(df[[c]].rename(columns={c: TARGET}).fillna(0))[:, 0]
    scaled[other_columns] = other_scaler.transform(df[other_columns].fillna(0))
    return scaled


def build_features(raw, freq="1h"):
    """raw: DataFrame indexed by timestamp with at least total_kw and temp_c (any finer frequency).
    Rows past the last reading (total_kw NaN) still get calendar and lag features, which is how
    predict.py builds the future inputs for the next horizon."""
    df = raw[[TARGET, "temp_c"]].resample(freq).mean()
    df["temp_c"] = df["temp_c"].interpolate(limit_direction="both")
    ts = df.index
    df["hour_sin"] = np.sin(2 * np.pi * (ts.hour + ts.minute / 60) / 24)
    df["hour_cos"] = np.cos(2 * np.pi * (ts.hour + ts.minute / 60) / 24)
    df["dow_sin"] = np.sin(2 * np.pi * ts.dayofweek / 7)
    df["dow_cos"] = np.cos(2 * np.pi * ts.dayofweek / 7)
    df["is_weekend"] = (ts.dayofweek >= 5).astype("float32")
    df["is_holiday"] = holiday_flags(ts)
    week = steps_per_week(freq)
    df["kw_lag_week"] = df[TARGET].shift(week)
    df["lag_week_was_holiday"] = df["is_holiday"].shift(week)
    return df
