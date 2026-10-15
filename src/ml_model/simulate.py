"""Replay AURA's forecast-driven, carbon-aware allocation over the held-out test period.

Every day at 00:00 (building local time) the trained LSTM forecasts the next 24 hours of campus demand
(CU-BEMS building load is the demand signal). AURA then:
  1. keeps just enough server nodes on for the forecast interactive demand plus a safety headroom,
  2. places the deferrable batch share of the day's work (backups, research jobs) in the hours with the
     lowest grid carbon intensity that still have spare capacity,
  3. at run time serves interactive demand first; batch work that does not fit is carried to the next hour.
     If interactive demand exceeds the nodes that were on, it scales up reactively and the hour counts
     as an SLA miss.
The baseline is static provisioning: every node on 24/7 and all work runs when it arrives.
Savings are computed from the simulated hours; nothing is typed in.

Writes the dashboard/API data contract to --out (default results/simulation/):
  energy_metrics.json, savings.json, allocations.json, alerts.json, forecast.json, simulation.png
and the hourly day-ahead backtest to --backtest (default dataset/processed/forecast_hourly.csv).

Usage: python src/ml_model/simulate.py [--carbon dataset/processed/carbon_hourly.csv] [--headroom 0.25]
"""
import argparse
import json
import math
import os

import joblib
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import tensorflow as tf

from predict import forecast

# Data-center assumptions (documented in results/simulation/README.md)
ASSUMPTIONS = {
    "nodes_total": 48,              # static fleet size, sized so peak training-period demand fills it
    "nodes_min": 4,                 # never scale below this (control plane, redundancy)
    "node_idle_kw": 0.12,           # per-node power when on but idle (idle share 40% of peak)
    "node_peak_kw": 0.30,           # per-node power at 100% utilisation
    "pue": 1.5,                     # data-center power usage effectiveness (cooling overhead)
    "headroom": 0.25,               # extra capacity above the forecast interactive demand (relative)
    "buffer_nodes": 4,              # plus this many spare nodes, so quiet hours still absorb surprises
    "batch_share": 0.20,            # deferrable share of each day's work
    "price_usd_per_kwh": 0.12,
    "instance_type": "c5.xlarge",
    "building_timezone": "Asia/Bangkok",
}
# Fallback hourly grid carbon intensity (gCO2/kWh, by local hour) when no --carbon file is given:
# illustrative shape for a gas-heavy grid with daytime solar, averaging ~0.49 kgCO2/kWh.
CARBON_PROFILE = [
    505, 500, 495, 490, 490, 495, 505, 495, 475, 455, 440, 430,
    425, 430, 440, 460, 490, 530, 560, 555, 545, 530, 520, 510,
]


def plan_day(fc_interactive, ci, batch_nodehours, a, shift=True):
    """Choose nodes per hour from the forecast and place batch work in the cleanest hours with room.
    shift=False runs batch work when it arrives (in proportion to demand), for comparison."""
    n_total = a["nodes_total"]
    need = np.minimum(fc_interactive * (1 + a["headroom"]) + a["buffer_nodes"], n_total)
    if not shift:
        batch = np.minimum(fc_interactive / max(fc_interactive.sum(), 1e-9) * batch_nodehours, n_total - need)
        return np.clip(np.ceil(need + batch), a["nodes_min"], n_total), batch, batch_nodehours - batch.sum()
    batch = np.zeros_like(need)
    remaining = batch_nodehours
    for h in np.argsort(ci, kind="stable"):
        if remaining <= 0:
            break
        take = min(remaining, n_total - need[h])
        if take > 0:
            batch[h] = take
            remaining -= take
    nodes = np.clip(np.ceil(need + batch), a["nodes_min"], n_total)
    return nodes, batch, remaining


def power_kw(nodes_on, work_nodes, a):
    dyn = a["node_peak_kw"] - a["node_idle_kw"]
    return (nodes_on * a["node_idle_kw"] + work_nodes * dyn) * a["pue"]


def load_carbon(path, index, tz):
    """Hourly carbon intensity aligned to the building's local timestamps (file is UTC)."""
    if not path:
        return pd.Series([CARBON_PROFILE[t.hour] for t in index], index=index, dtype=float), "illustrative profile"
    ci = pd.read_csv(path, parse_dates=["ts"]).set_index("ts")["gco2_per_kwh"]
    ci.index = ci.index.tz_convert(tz).tz_localize(None)
    aligned = ci.reindex(index).interpolate(limit=3, limit_direction="both")
    if aligned.isna().any():
        raise SystemExit(f"{path} does not cover {aligned.isna().sum()} simulated hours")
    return aligned, os.path.basename(path)


def replay(days, hourly, forecast_fn, carbon, a, to_nodes, usual_mae, shift=True, actual_factor=None, forecast_factor=None):
    """Replay the forecast-driven allocation day by day.
    forecast_fn(day) -> predict.forecast() result for the 24 h starting at `day`.
    actual_factor / forecast_factor: optional f(DatetimeIndex) -> array that scales the real demand (what-if events)
    or the forecast (events the planner knows about); the LSTM output itself is untouched."""
    rows, alerts, backtest, skipped = [], [], [], []
    prev_nodes, backlog = None, 0.0
    for day in days:
        actual_kw = hourly.reindex(pd.date_range(day, periods=24, freq="1h"))
        if actual_kw.isna().any():
            backlog = 0.0
            skipped.append((day, "gap in the record"))
            continue  # skip days with gaps in the record
        try:
            fc = forecast_fn(day)
        except ValueError as exc:
            skipped.append((day, str(exc)))
            continue
        if actual_factor:
            actual_kw = actual_kw * actual_factor(actual_kw.index)
        fc_kw = np.array([r["total_kw"] for r in fc["forecast"]])
        if forecast_factor:
            fc_kw = fc_kw * forecast_factor(actual_kw.index)
        holiday = fc["forecast"][0]["is_holiday"]
        ci_day = carbon.reindex(actual_kw.index).to_numpy()
        backtest += [(t, float(x), float(p)) for t, x, p in zip(actual_kw.index, actual_kw, fc_kw)]

        demand = actual_kw.to_numpy() * to_nodes                  # actual work, node units
        fc_demand = fc_kw * to_nodes
        fc_interactive = (1 - a["batch_share"]) * fc_demand
        nodes, planned_batch, unplaced = plan_day(
            fc_interactive, ci_day, a["batch_share"] * fc_demand.sum(), a, shift=shift
        )
        act_interactive = (1 - a["batch_share"]) * demand
        # Batch jobs actually submitted today: the real batch share, released on the planned slots
        released = planned_batch * (a["batch_share"] * demand.sum()) / max(planned_batch.sum(), 1e-9)

        for h, t in enumerate(actual_kw.index):
            inter = act_interactive[h]
            short = inter > nodes[h] + 1e-9
            nodes_on = min(math.ceil(inter), a["nodes_total"]) if short else int(nodes[h])
            available = released[h] + backlog
            batch_done = min(available, max(nodes_on - inter, 0.0))
            backlog = available - batch_done
            work = min(inter, nodes_on) + batch_done

            p = power_kw(nodes_on, work, a)
            p_base = power_kw(a["nodes_total"], min(demand[h], a["nodes_total"]), a)
            p_plan = power_kw(nodes[h], min(fc_interactive[h] + planned_batch[h], nodes[h]), a)
            ci = float(ci_day[h])
            rows.append({
                "timestamp": t.isoformat(),
                "utilization": round(100 * work / nodes_on, 1),
                "activeNodes": nodes_on,
                "plannedNodes": int(nodes[h]),
                "energyKwh": round(p, 3),
                "predicted": round(p_plan, 3),
                "baselineEnergyKwh": round(p_base, 3),
                "cost": round(p * a["price_usd_per_kwh"], 4),
                "baselineCost": round(p_base * a["price_usd_per_kwh"], 4),
                "carbonIntensity": round(ci, 1),
                "carbonGco2": round(p * ci, 1),
                "baselineCarbonGco2": round(p_base * ci, 1),
                "forecastDemandKw": round(float(fc_kw[h]), 1),
                "actualDemandKw": round(float(actual_kw.iloc[h]), 1),
                "batchNodeHours": round(batch_done, 2),
                "batchBacklogNodeHours": round(backlog, 2),
                "slaMet": not short,
            })
            if short:
                alerts.append({
                    "timestamp": t.isoformat(), "type": "scaling", "severity": "critical",
                    "message": f"Interactive demand exceeded forecast capacity ({inter:.1f} vs {nodes[h]:.0f} nodes); "
                               f"reactively scaled to {nodes_on} nodes",
                })
            if prev_nodes is not None and abs(nodes[h] - prev_nodes) >= 8:
                direction = "up" if nodes[h] > prev_nodes else "down"
                alerts.append({
                    "timestamp": t.isoformat(), "type": "scaling", "severity": "info",
                    "message": f"Scaled {direction} from {prev_nodes:.0f} to {nodes[h]:.0f} nodes "
                               f"(forecast {fc_kw[h]:.0f} kW campus demand)",
                })
            prev_nodes = nodes[h]

        cleanest = sorted(np.argsort(ci_day)[:3])
        alerts.append({
            "timestamp": day.isoformat(), "type": "carbon", "severity": "info",
            "message": f"Scheduled {planned_batch.sum():.0f} node-hours of batch work into the cleanest hours "
                       f"({', '.join(f'{h:02d}:00' for h in cleanest)}, "
                       f"{ci_day.min():.0f}-{np.sort(ci_day)[2]:.0f} gCO2/kWh vs peak {ci_day.max():.0f})",
        })
        if unplaced > 0:
            alerts.append({
                "timestamp": day.isoformat(), "type": "carbon", "severity": "warning",
                "message": f"{unplaced:.1f} node-hours of batch work could not be placed in spare capacity",
            })
        if holiday:
            alerts.append({
                "timestamp": day.isoformat(), "type": "forecast", "severity": "info",
                "message": f"Public holiday detected: forecast peak {fc_kw.max():.0f} kW, holding fleet near minimum",
            })
        err = np.abs(fc_kw - actual_kw.to_numpy()).mean()
        if err > 2 * usual_mae:
            alerts.append({
                "timestamp": (day + pd.Timedelta(hours=23)).isoformat(), "type": "forecast", "severity": "warning",
                "message": f"Forecast error {err:.0f} kW today, over twice the model's usual {usual_mae:.0f} kW; "
                           f"check for unscheduled campus events",
            })

    return {"rows": rows, "alerts": alerts, "backtest": backtest, "backlog": backlog, "skipped": skipped}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="dataset/processed/cubems_building_15min.csv")
    ap.add_argument("--model", default="results/model")
    ap.add_argument("--out", default="results/simulation")
    ap.add_argument("--carbon", help="hourly carbon CSV (ts UTC, gco2_per_kwh) from fetch_carbon.py")
    ap.add_argument("--backtest", default="dataset/processed/forecast_hourly.csv")
    ap.add_argument("--headroom", type=float, default=ASSUMPTIONS["headroom"])
    ap.add_argument("--buffer-nodes", type=int, default=ASSUMPTIONS["buffer_nodes"])
    ap.add_argument("--start", help="first day to simulate; default: first full day of the model's test period")
    ap.add_argument("--end", help="last day (exclusive); default: last complete day of data")
    ap.add_argument("--no-carbon-shift", action="store_true", help="run batch work on arrival (ablation)")
    ap.add_argument("--quiet", action="store_true", help="only print the savings summary")
    args = ap.parse_args()
    a = dict(ASSUMPTIONS, headroom=args.headroom, buffer_nodes=args.buffer_nodes)

    raw = pd.read_csv(args.data, parse_dates=["timestamp"], index_col="timestamp")
    model = tf.keras.models.load_model(os.path.join(args.model, "aura_lstm.keras"))
    bundle = joblib.load(os.path.join(args.model, "scaler.joblib"))
    with open(os.path.join(args.model, "metrics.json")) as f:
        model_metrics = json.load(f)
    test_start = model_metrics["periods"]["test"][0]
    train_end = model_metrics["periods"]["train"][1]
    usual_mae = model_metrics["test"]["lstm"]["mae_kw"]

    hourly = raw["total_kw"].resample("1h").mean()
    # Demand in node units: the fleet is sized so that peak training-period load fills every node
    # (training period only, so neither validation nor test data leaks into the sizing)
    ref_kw = hourly[hourly.index <= pd.Timestamp(train_end)].max()
    to_nodes = a["nodes_total"] / ref_kw

    start = pd.Timestamp(args.start or test_start).ceil("D")
    end = pd.Timestamp(args.end) if args.end else hourly.dropna().index[-1].floor("D")
    days = pd.date_range(start, end - pd.Timedelta(days=1), freq="D")
    carbon, carbon_source = load_carbon(
        args.carbon, pd.date_range(start, end, freq="1h", inclusive="left"), a["building_timezone"]
    )

    res = replay(days, hourly, lambda day: forecast(raw, model, bundle, day), carbon, a, to_nodes, usual_mae,
                 shift=not args.no_carbon_shift)
    rows, alerts, backtest, backlog = res["rows"], res["alerts"], res["backtest"], res["backlog"]

    if not rows:
        raise SystemExit("no complete days to simulate")
    df = pd.DataFrame(rows)
    e, eb = df["energyKwh"].sum(), df["baselineEnergyKwh"].sum()
    c, cb = df["carbonGco2"].sum() / 1000, df["baselineCarbonGco2"].sum() / 1000
    savings = {
        "energySavedKwh": round(eb - e, 1),
        "carbonSavedKg": round(cb - c, 1),
        "costSaved": round(df["baselineCost"].sum() - df["cost"].sum(), 2),
        "percentReduction": round(100 * (eb - e) / eb, 1),
        "carbonPercentReduction": round(100 * (cb - c) / cb, 1),
        "slaCompliancePct": round(100 * df["slaMet"].mean(), 2),
        "energyKwh": round(e, 1),
        "baselineEnergyKwh": round(eb, 1),
        "carbonKg": round(c, 1),
        "baselineCarbonKg": round(cb, 1),
        "avgActiveNodes": round(df["activeNodes"].mean(), 1),
        "batchBacklogEndNodeHours": round(backlog, 2),
        "period": {"start": rows[0]["timestamp"], "end": rows[-1]["timestamp"], "hours": len(rows)},
        "carbonSource": carbon_source,
        "assumptions": a | {"idle_share_of_peak": a["node_idle_kw"] / a["node_peak_kw"]},
    }
    summary = {k: v for k, v in savings.items() if k != "assumptions"}
    if args.quiet:
        print(json.dumps(summary))
        return

    os.makedirs(args.out, exist_ok=True)
    last = rows[-1]
    allocations = [
        {"resourceId": f"aura-node-{i + 1:02d}", "service": "Amazon EC2", "capacity": a["instance_type"],
         "status": "Running" if i < last["activeNodes"] else "Stopped"}
        for i in range(a["nodes_total"])
    ] + [
        {"resourceId": "aura-forecast-scheduler", "service": "AWS Lambda", "status": "Active", "capacity": "1024 MB"},
        {"resourceId": "aura-lstm-endpoint", "service": "Amazon SageMaker", "status": "Running", "capacity": "ml.t2.medium"},
    ]
    alerts.sort(key=lambda x: x["timestamp"], reverse=True)
    next_fc = forecast(raw, model, bundle)  # next day from the end of the record, for the forecast panel

    def dump(name, obj):
        with open(os.path.join(args.out, name), "w") as f:
            json.dump(obj, f, indent=1)

    dump("energy_metrics.json", rows)
    dump("savings.json", savings)
    dump("allocations.json", allocations)
    dump("alerts.json", alerts)
    dump("forecast.json", next_fc)
    if args.backtest:
        bt = pd.DataFrame(backtest, columns=["ts", "actual_kwh", "forecast_kwh"]).round(2)
        bt.to_csv(args.backtest, index=False)

    week = df.tail(24 * 7)
    t = pd.to_datetime(week["timestamp"])
    fig, axes = plt.subplots(4, 1, figsize=(12, 12), sharex=True)
    axes[0].plot(t, week["actualDemandKw"], label="actual demand", linewidth=1)
    axes[0].plot(t, week["forecastDemandKw"], label="day-ahead forecast", linewidth=1)
    axes[0].set(ylabel="campus demand (kW)", title="Last simulated week")
    axes[0].legend()
    axes[1].step(t, [a["nodes_total"]] * len(t), label="static baseline", where="post", color="gray", linestyle="--")
    axes[1].step(t, week["activeNodes"], label="AURA active nodes", where="post")
    axes[1].set(ylabel="nodes on")
    axes[1].legend()
    axes[2].plot(t, week["carbonIntensity"], color="green")
    axes[2].bar(t, week["batchNodeHours"] * 10, width=1 / 24, alpha=0.4, label="batch work (x10 node-h)")
    axes[2].set(ylabel=f"gCO2/kWh ({carbon_source})")
    axes[2].legend()
    axes[3].plot(t, week["baselineEnergyKwh"], label="baseline", color="gray", linestyle="--")
    axes[3].plot(t, week["energyKwh"], label="AURA")
    axes[3].set(ylabel="data-center energy (kWh)")
    axes[3].legend()
    fig.suptitle(
        f"{savings['percentReduction']}% energy and {savings['carbonPercentReduction']}% carbon saved, "
        f"SLA {savings['slaCompliancePct']}% over {len(rows)} hours "
        f"(headroom {a['headroom']:.0%} + {a['buffer_nodes']} nodes)"
    )
    fig.tight_layout()
    fig.savefig(os.path.join(args.out, "simulation.png"), dpi=120)
    print(json.dumps(summary, indent=2))
    print(f"{len(alerts)} alerts; wrote {args.out}" + (f" and {args.backtest}" if args.backtest else ""))


if __name__ == "__main__":
    main()
