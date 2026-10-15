"""Tests for the engine behind /api/simulate, /api/forecast/preview and /api/upload.

Run: .venv/Scripts/python -m pytest src/ml_model/tests   (loads the trained LSTM once, ~10 s)
"""
import os
import sys

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from engine import Engine, ValidationError  # noqa: E402


@pytest.fixture(scope="module")
def eng(tmp_path_factory):
    return Engine(upload_dir=str(tmp_path_factory.mktemp("uploads")))


WEEK = {"startDate": "2019-09-02", "endDate": "2019-09-08"}


def csv_of(days=20, start="2024-03-01", noise=0.0, hourly=True, weekend_dip=True):
    idx = pd.date_range(start, periods=days * 24 * (1 if hourly else 4), freq="1h" if hourly else "15min")
    kw = 5 + 10 * ((idx.hour >= 8) & (idx.hour < 18)) - (2 if weekend_dip else 0) * (idx.dayofweek >= 5)
    kw = kw + noise * np.random.default_rng(0).standard_normal(len(idx))
    return pd.DataFrame({"timestamp": idx, "kw": kw}).to_csv(index=False)


# ---- simulate -------------------------------------------------------------------------------------------------------

def test_simulate_defaults_and_shape(eng):
    r = eng.simulate({})
    assert len(r["hourly"]) % 24 == 0 and len(r["hourly"]) == 168
    assert {"ts", "demandKw", "serversOn", "energyKwh", "baselineKwh", "co2G", "baselineCo2G", "carbonIntensity"} <= set(r["hourly"][0])
    s = r["summary"]
    assert s["energySavedKwh"] > 0 and 0 < s["slaPct"] <= 100
    assert s["energySavedKwh"] == pytest.approx(sum(h["baselineKwh"] - h["energyKwh"] for h in r["hourly"]), abs=1)
    assert len(r["recommendations"]) <= 8


def test_aura_never_uses_more_servers_than_the_pool(eng):
    r = eng.simulate({**WEEK, "servers": 10})
    assert max(h["serversOn"] for h in r["hourly"]) <= 10


def test_inputs_change_outputs(eng):
    base = eng.simulate(WEEK)["summary"]
    assert eng.simulate({**WEEK, "servers": 200})["summary"]["energySavedKwh"] != base["energySavedKwh"]
    assert eng.simulate({**WEEK, "carbonGrid": "india"})["summary"]["co2SavedKg"] != base["co2SavedKg"]
    assert eng.simulate({**WEEK, "idleWatts": 200})["summary"]["energySavedKwh"] != base["energySavedKwh"]
    assert eng.simulate({**WEEK, "deferrableShare": 0.9})["summary"]["co2SavedKg"] != base["co2SavedKg"]


def test_events_change_demand_and_unplanned_event_hits_sla(eng):
    base = eng.simulate(WEEK)
    exam = eng.simulate({**WEEK, "events": ["exam"]})
    brk = eng.simulate({**WEEK, "events": ["break"]})
    assert sum(h["demandKw"] for h in exam["hourly"]) > sum(h["demandKw"] for h in base["hourly"])
    assert sum(h["demandKw"] for h in brk["hourly"]) < sum(h["demandKw"] for h in base["hourly"])
    surprise = eng.simulate({**WEEK, "events": ["event"], "servers": 20})
    assert surprise["summary"]["slaPct"] <= base["summary"]["slaPct"]


def test_carbon_shifting_lowers_carbon_on_a_varying_grid(eng):
    on = eng.simulate({**WEEK, "carbonGrid": "india", "deferrableShare": 0.5})["summary"]
    off = eng.simulate({**WEEK, "carbonGrid": "india", "deferrableShare": 0.5, "carbonShift": False})["summary"]
    assert on["co2Kg"] <= off["co2Kg"]


def test_flat_grid_warns(eng):
    assert any("flat" in w for w in eng.simulate({**WEEK, "carbonGrid": "flat-high"})["warnings"])


@pytest.mark.parametrize("body,field", [
    ({"servers": 0}, "servers"), ({"servers": 1001}, "servers"), ({"servers": 2.5}, "servers"), ({"servers": "5"}, "servers"),
    ({"servers": True}, "servers"), ({"idleWatts": 5}, "idleWatts"), ({"idleWatts": 300, "peakWatts": 300}, "peakWatts"),
    ({"peakWatts": 2000}, "peakWatts"), ({"deferrableShare": -0.1}, "deferrableShare"),
    ({"carbonGrid": "mars"}, "carbonGrid"), ({"carbonGrid": [1, 2]}, "carbonGrid"), ({"events": "exam"}, "events"),
    ({"events": ["party"]}, "events"), ({"startDate": "09/02/2019"}, "startDate"), ({"startDate": "2019-02-30"}, "startDate"),
    ({"startDate": "2018-07-01", "endDate": "2018-07-03"}, "startDate"),
    ({"startDate": "2019-09-05", "endDate": "2019-09-01"}, "endDate"),
    ({"startDate": "2019-08-01", "endDate": "2019-09-15"}, "endDate"), ({"startDate": "2025-01-01", "endDate": "2025-01-02"}, "endDate"),
    ({"dataset": "unknown"}, "dataset"), ({"carbonShift": "yes"}, "carbonShift"),
])
def test_validation_errors_name_the_field(eng, body, field):
    with pytest.raises(ValidationError) as exc:
        eng.simulate(body)
    assert exc.value.field == field and exc.value.kind == "validation"


def test_non_object_body(eng):
    with pytest.raises(ValidationError):
        eng.simulate([])


def test_uk_grid_only_where_covered(eng):
    assert eng.simulate({**WEEK, "carbonGrid": "uk-2019"})["summary"]["carbonSource"] == "uk-2019"
    with pytest.raises(ValidationError) as exc:
        eng.simulate({"startDate": "2018-09-01", "endDate": "2018-09-03", "carbonGrid": "uk-2019"})
    assert exc.value.field == "carbonGrid"


# ---- preview --------------------------------------------------------------------------------------------------------

def test_preview_has_forecast_and_real_values(eng):
    r = eng.preview("2019-09-10")
    assert len(r["hourly"]) == 24
    assert all(h["actualKw"] is not None and h["forecastKw"] > 0 for h in r["hourly"])
    assert r["summary"]["maeKw"] < 150
    assert r["hourly"][0]["ts"] == "2019-09-10T00:00:00Z"


def test_preview_partial_day_has_nulls_and_out_of_range_fails(eng):
    r = eng.preview("2019-10-22")
    assert any(h["actualKw"] is None for h in r["hourly"]) and any(h["actualKw"] is not None for h in r["hourly"])
    for bad in ("2019-10-24", "2018-07-02", "tomorrow"):
        with pytest.raises(ValidationError) as exc:
            eng.preview(bad)
        assert exc.value.field == "date"


# ---- upload ---------------------------------------------------------------------------------------------------------

def test_upload_rescales_and_simulates(eng):
    r = eng.upload_and_simulate(csv_of(noise=0.3), "x.csv", {"servers": 30})
    assert r["upload"]["scale"]["targetP99"] > r["upload"]["scale"]["originalP99"]
    assert any("Rescaled" in w for w in r["warnings"])
    assert len(r["hourly"]) >= 24 and r["params"]["servers"] == 30
    # the rescaled series is reachable by id for previews
    p = eng.preview(r["upload"]["simulateFrom"], r["upload"]["uploadId"])
    assert all(h["actualKw"] is not None for h in p["hourly"])


def test_upload_quarter_hourly_is_averaged(eng):
    r = eng.upload_and_simulate(csv_of(hourly=False, noise=0.2), None, {})
    assert r["upload"]["hours"] >= 20 * 24 - 2


def test_upload_warns_when_unlike_cubems(eng):
    flat_shape = csv_of(noise=1.0).replace(",15", ",9")  # keep it valid; shape differs below
    idx = pd.date_range("2024-03-01", periods=20 * 24, freq="1h")
    odd = pd.DataFrame({"timestamp": idx, "kw": 10 + 8 * ((idx.hour >= 0) & (idx.hour < 6)) + (idx.dayofweek >= 5) * 5})
    r = eng.upload(odd.to_csv(index=False))
    text = " ".join(r["warnings"])
    assert "differs from CU-BEMS" in text and "Weekend load" in text
    assert flat_shape


@pytest.mark.parametrize("text,kind", [
    ("", "csv"), ("a,b\n1,2\n", "csv"), ("timestamp,kw\nfoo,bar\nbaz,qux\n", "csv"),
    ("timestamp,kw\n" + "\n".join(f"2024-03-01 {h:02d}:00,5" for h in range(24)), "csv"),     # one day only
    (csv_of(days=40), "too_large"),
])
def test_upload_rejections(eng, text, kind):
    with pytest.raises(ValidationError) as exc:
        eng.upload(text)
    assert exc.value.kind == kind


def test_upload_constant_series_rejected(eng):
    idx = pd.date_range("2024-03-01", periods=20 * 24, freq="1h")
    with pytest.raises(ValidationError, match="constant"):
        eng.upload(pd.DataFrame({"timestamp": idx, "kw": 7.0}).to_csv(index=False))


def test_upload_cleans_bad_rows_and_negatives(eng):
    lines = csv_of().splitlines()
    lines[5] = "garbage,1"
    lines[9] = lines[9].split(",")[0] + ",-4"
    lines += [lines[3]]  # duplicate timestamp
    r = eng.upload("\n".join(lines))
    text = " ".join(r["warnings"])
    assert "unreadable" in text and "negative" in text and "duplicate" in text


def test_unknown_upload_id(eng):
    with pytest.raises(ValidationError):
        eng.preview("2019-09-10", "abcdef123456")
