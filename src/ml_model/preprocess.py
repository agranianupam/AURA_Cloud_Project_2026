"""Preprocess the CU-BEMS raw CSVs into compact, model-ready time series.

Input:  dataset/raw/{2018,2019}Floor{1..7}.csv  (1-minute readings, one file per floor per year)
Output: dataset/processed/cubems_floors_<freq>.csv    one row per (timestamp, floor)
        dataset/processed/cubems_building_<freq>.csv  whole-building totals + calendar features
        dataset/processed/preprocess_report.txt       gap / coverage summary

Usage:  python src/ml_model/preprocess.py [--freq 15min] [--raw dataset/raw] [--out dataset/processed]
"""
import argparse
import glob
import os
import re

import pandas as pd

FILE_RE = re.compile(r"(\d{4})Floor(\d+)\.csv$")
MAX_INTERP_STEPS = 4

def load_floor_year(path):
    df = pd.read_csv(path)
    df["Date"] = pd.to_datetime(df["Date"], format="%Y-%m-%d %H:%M:%S", errors="coerce")
    bad_dates = int(df["Date"].isna().sum())
    if bad_dates:
        print(f"  dropped {bad_dates} rows with unparseable Date in {os.path.basename(path)}")
    df = df.dropna(subset=["Date"]).drop_duplicates("Date").set_index("Date").sort_index()
    kw = [c for c in df.columns if c.endswith("(kW)")]

    def cols(pattern):
        return [c for c in df.columns if re.search(pattern, c)]

    out = pd.DataFrame(index=df.index)
    out["total_kw"] = df[kw].sum(axis=1, min_count=1)
    out["ac_kw"] = df[cols(r"_AC\d*\(kW\)")].sum(axis=1, min_count=1)
    out["light_kw"] = df[cols(r"_Light\(kW\)")].sum(axis=1, min_count=1)
    out["plug_kw"] = df[cols(r"_Plug\(kW\)")].sum(axis=1, min_count=1)
    out["temp_c"] = df[cols(r"\(degC\)")].mean(axis=1)
    out["rh_pct"] = df[cols(r"\(RH%\)")].mean(axis=1)
    out["lux"] = df[cols(r"\(lux\)")].mean(axis=1)
    return out

def add_calendar(df):
    ts = df.index
    df["hour"] = ts.hour
    df["dayofweek"] = ts.dayofweek
    df["month"] = ts.month
    df["is_weekend"] = (ts.dayofweek >= 5).astype(int)
    return df

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default="dataset/raw")
    ap.add_argument("--out", default="dataset/processed")
    ap.add_argument("--freq", default="15min", help="pandas resample rule, e.g. 15min or 1h")
    args = ap.parse_args()

    files = sorted(glob.glob(os.path.join(args.raw, "*.csv")))
    by_floor = {}
    for path in files:
        m = FILE_RE.search(os.path.basename(path))
        if not m:
            continue
        floor = int(m.group(2))
        print(f"reading {os.path.basename(path)}")
        by_floor.setdefault(floor, []).append(load_floor_year(path))
    if not by_floor:
        raise SystemExit(f"no YYYYFloorN.csv files in {args.raw}")

    report = []
    floor_frames = []
    for floor in sorted(by_floor):
        df = pd.concat(by_floor[floor]).sort_index()
        df = df[~df.index.duplicated()]
        df = df.resample(args.freq).mean()
        missing = df["total_kw"].isna().sum()
        df = df.interpolate(limit=MAX_INTERP_STEPS, limit_area="inside")
        still_missing = df["total_kw"].isna().sum()
        report.append(
            f"floor {floor}: {df.index.min()} -> {df.index.max()}, {len(df)} steps, "
            f"{missing} empty before interpolation, {still_missing} still empty (long gaps)"
        )
        df.insert(0, "floor", floor)
        floor_frames.append(df)

    floors = pd.concat(floor_frames)
    os.makedirs(args.out, exist_ok=True)
    floors_path = os.path.join(args.out, f"cubems_floors_{args.freq}.csv")
    floors.rename_axis("timestamp").to_csv(floors_path, float_format="%.3f")

    n_floors = len(by_floor)
    power = floors.reset_index().pivot_table(
        index="Date", columns="floor", values=["total_kw", "ac_kw", "light_kw", "plug_kw"], dropna=False
    )
    complete = power["total_kw"].notna().sum(axis=1) == n_floors
    building = pd.DataFrame(
        {c: power[c].sum(axis=1) for c in ["total_kw", "ac_kw", "light_kw", "plug_kw"]}
    )[complete]
    env = floors.groupby(level=0)[["temp_c", "rh_pct", "lux"]].mean()
    building = add_calendar(building.join(env))
    building_path = os.path.join(args.out, f"cubems_building_{args.freq}.csv")
    building.rename_axis("timestamp").to_csv(building_path, float_format="%.3f")

    report.append(
        f"building: {len(building)} complete steps of {len(power)} "
        f"({len(power) - len(building)} dropped because a floor was missing)"
    )
    with open(os.path.join(args.out, "preprocess_report.txt"), "w") as f:
        f.write("\n".join(report) + "\n")
    print("\n".join(report))
    print(f"wrote {floors_path}\nwrote {building_path}")

if __name__ == "__main__":
    main()
