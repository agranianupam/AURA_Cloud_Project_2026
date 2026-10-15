# AURA interactive API contract (v1) — owner: T3, implementer: T1

Base URL: `VITE_API_BASE_URL` (default `http://localhost:3000`). JSON in/out, UTF-8. Timestamps ISO-8601 UTC (`2025-03-10T14:00:00Z`). Hourly resolution.

## POST /api/simulate
Runs the trained forecast model for the requested period and the carbon-aware allocation simulation, returns results vs. an always-on baseline.

### Request body
| field | type | range | default | meaning |
|---|---|---|---|---|
| startDate | `YYYY-MM-DD` | within dataset-supported range | first day of model test window | first day (inclusive) |
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
    { "ts": "2025-03-10T00:00:00Z", "demandKw": 12.4, "serversOn": 18,
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
{ "date": "2025-03-10",
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
