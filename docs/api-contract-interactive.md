# AURA interactive API contract (v1) — owner: T3, implementer: T1

Base URL: `VITE_API_BASE_URL` (default `http://localhost:3000`). JSON in/out, UTF-8. Timestamps ISO-8601 UTC (`2019-08-12T14:00:00Z`). Hourly resolution.

## POST /api/simulate
Runs the trained forecast model for the requested period and the carbon-aware allocation simulation, returns results vs. an always-on baseline.

### Request body
| field | type | range | default | meaning |
|---|---|---|---|---|
| startDate | `YYYY-MM-DD` | within dataset-supported range | 2019-08-12 (start of the model test window) | first day (inclusive) |
| endDate | `YYYY-MM-DD` | >= startDate, span <= 31 days | startDate + 6 days | last day (inclusive) |
| servers | int | 1–1000 | 50 | servers in the pool |
| idleWatts | number | 10–500 | 100 | power of an idle, powered-on server |
| peakWatts | number | idleWatts+1 – 1500 | 250 | power at 100% utilisation |
| deferrableShare | number | 0–1 | 0.3 | share of load that can be shifted to greener hours |
| carbonGrid | string | `"low"`,`"medium"`,`"high"`, `"india"` | `"medium"` | grid carbon profile (gCO2/kWh curve) |
| events | string[] | any of `"exam"`,`"break"`,`"holiday"`,`"event"` | `[]` | calendar events that change demand (exam = +, break/holiday = −) |

All fields optional; missing fields take defaults.

### Response 200
```json
{
  "hourly": [
    { "ts": "2019-08-12T00:00:00Z", "demandKw": 12.4, "serversOn": 18,
      "energyKwh": 3.1, "baselineKwh": 5.0, "co2G": 1200, "baselineCo2G": 1900,
      "carbonIntensity": 390 }
  ],
  "summary": { "energySavedKwh": 120.5, "co2SavedKg": 48.2, "costSaved": 15.1, "slaPct": 99.2 },
  "recommendations": ["Shift batch jobs to 02:00-05:00 when the grid is cleanest."]
}
```
- `hourly` has one row per hour from startDate 00:00 to endDate 23:00, sorted.
- `energyKwh`/`co2G` = AURA result; `baselineKwh`/`baselineCo2G` = all servers on. `carbonIntensity` in gCO2/kWh. `slaPct` in 0–100. `costSaved` in USD.
- `recommendations` are plain-language sentences (0–8).
- Different inputs MUST yield different outputs (inputs are not ignored).

## GET /api/forecast/preview?date=YYYY-MM-DD
```json
{ "date": "2019-08-12",
  "hourly": [ { "ts": "...", "forecastKw": 12.4, "actualKw": 11.9 } ] }
```
24 rows. `actualKw` present only where known (omit or `null` otherwise).

## POST /api/upload
`multipart/form-data`, field `file` = CSV with header `timestamp,kw` (hourly or finer; finer is averaged to hourly). Max 5 MB, max 31 days. Optional text fields: same params as /simulate (servers, idleWatts, peakWatts, deferrableShare, carbonGrid).
Response 200: same shape as /simulate plus `"warnings": [string]` (e.g. gaps filled, rows skipped). Experimental.

## Errors
HTTP 400 (validation), 413 (too large), 422 (unparseable CSV), 500 (server). Body:
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "servers must be between 1 and 1000", "field": "servers" } }
```
`code` ∈ `VALIDATION_ERROR`, `CSV_INVALID`, `TOO_LARGE`, `INTERNAL`. `field` optional. `message` is human-readable and shown to the teacher verbatim.

## Notes
- CORS must allow the frontend origin. Auth: same as existing routes (`AUTH_DISABLED=true` locally).

## T1 implementation notes (additive; nothing above was changed)
- `ts` is the building's local wall-clock time (Asia/Bangkok, the CU-BEMS site) written with a `Z` suffix, so charts can show the hour directly. Hours with no CU-BEMS data cannot be simulated.
- Dates: CU-BEMS supports 2018-07-15 .. 2019-10-21 (simulate) and .. 2019-10-22 (preview; the last day is partial, `actualKw` is `null` where unknown). Defaults: startDate 2019-08-12 (first test day), endDate startDate+6.
- `carbonGrid` curves are fixed 24 h profiles. Extras accepted: `"uk-2019"` (real UK data, only 2019-05-31..10-23), `"flat-low"`, `"flat-high"`, or an array of 24 gCO2/kWh numbers.
- `events` apply to every day of the period: `exam` weekdays 08-20h x1.3 (planned, in the forecast), `break` x0.6 and `holiday` x0.45 (planned), `event` 10-16h x1.3 (unplanned: NOT in the forecast, so it can cause SLA misses). Duplicates are ignored.
- `demandKw` = server-pool demand at full utilisation (building load scaled to the pool); `forecastKw` is the LSTM forecast in the same unit.
- Extra response fields: hourly `forecastKw, plannedServers, utilizationPct, batchNodeHours, slaMet`; summary `percentReduction, co2PercentReduction, slaMissHours, energyKwh, baselineKwh, co2Kg, baselineCo2Kg, avgServersOn, peakServersOn, carbonSource, period`; top level `daily[]`, `alerts[]`, `params` (normalised echo), `model` (test MAE etc.), `warnings[]`, `elapsedMs`. Extra optional request fields: `headroom, pue, pricePerKwh, carbonShift, dataset`.
- Preview also returns `summary` (peak, MAE vs actual) and `warnings`; optional `?dataset=<uploadId>`.
- Upload: simulates every complete day after the first 14 (the model needs two weeks of history), 16-31 days of data required; response is the simulate shape plus `warnings[]` and `upload{uploadId, scale, similarity, simulateFrom, simulateTo}`. 413 when the file is > 5 MB or > 31 days, 422 when the CSV is unusable (bad header, <5% parseable, constant, < 16 days).
- Other errors: 404 uses `{error:{code:"NOT_FOUND",...}}`, 503 `INTERNAL` when the Python engine is unavailable.
