# src/backend/
Two Express APIs live here.

## Dashboard + interactive API (`npm start`, port 3000)
`src/server.js` serves the dashboard datasets (`results/simulation/*.json`, or DynamoDB when `DYNAMODB_TABLE` is set) and runs the trained LSTM on demand through a long-lived Python worker (`src/ml_model/engine_server.py`, started when the server starts; the model loads in about 5 s).

```bash
python -m venv .venv                      # Python 3.10-3.12
.venv/Scripts/pip install -r src/ml_model/requirements.txt     # Windows; use .venv/bin/ elsewhere
cd src/backend && npm install
AUTH_DISABLED=true npm start              # PORT, CORS_ORIGIN, PYTHON (interpreter), ENGINE_WARM=false
```
The interpreter is `$PYTHON`, else `.venv/` in the repo root, else `python`.

| Endpoint | What it does |
|---|---|
| `POST /api/simulate` | LSTM forecast + carbon-aware allocation for the dates, servers, power, deferrable share, carbon grid and events given |
| `GET /api/forecast/preview?date=YYYY-MM-DD` | 24 h LSTM forecast with the measured CU-BEMS value where one exists |
| `POST /api/upload` | multipart `file` (CSV `timestamp,kw`), rescaled to the model's range, then simulated; returns warnings |
| `GET /api/metrics/energy, /metrics/savings, /allocations, /alerts, /forecast, /health` | precomputed dataset from `simulate.py` |

Request/response shapes: `docs/api-contract-interactive.md` (contract by T3 plus T1 implementation notes). Errors are `{error:{code,message,field?}}` with 400 / 413 / 422 / 500 / 503.

## AWS API (`npm run start:aws`)
`server.js` (CommonJS): DynamoDB + Cognito + SNS routes under `routes/`, `services/`, `db/`.

## Tests
`npm test` runs `test/` (ESM; includes tests against the real model, skipped without `.venv`) and `tests/` (AWS API). Python engine tests: `.venv/Scripts/python -m pytest src/ml_model/tests`.
