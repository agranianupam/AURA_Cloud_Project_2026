# AURA — API Contract

This is the locked contract all three tracks (ML, Backend, Frontend) build against.
Backend implements it, frontend consumes it, ML's prediction output feeds into
`GET /api/metrics/energy`'s `predicted` field.

Base URL (local dev): `http://localhost:3000`

## Auth

All `/api/*` routes require a Cognito-issued JWT:

```
Authorization: Bearer <id_token>
```

Requests without a valid token receive `401 { "error": "Unauthorized" }`.

## `GET /api/health`

No auth required. Liveness check.

**Response `200`**
```json
{ "status": "ok" }
```

## `GET /api/metrics/energy`

Historical utilization/cost/energy/carbon readings from DynamoDB (`ResourceUsage`
table), merged with predicted values from the ML service where available.

**Response `200`**
```json
{
  "data": [
    {
      "timestamp": "2026-08-01T00:00:00Z",
      "utilization": 62.3,
      "cost": 4.12,
      "predicted": 65.0,
      "energyKwh": 1.84,
      "carbonIntensity": 640,
      "carbonGco2": 1178,
      "baselineEnergyKwh": 2.30,
      "baselineCarbonGco2": 1472
    }
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `timestamp` | string, ISO 8601 | Partition key of `ResourceUsage` |
| `utilization` | number | Percent, 0–100 |
| `cost` | number | USD |
| `predicted` | number | From ML service; falls back to `null` if ML service is unreachable |
| `energyKwh` | number \| null | Modelled estimate. Owned by the ML/scheduler track (power model, PRD FR-SC-2); backend reads it straight from `ResourceUsage` and passes it through — never computes it. `null` if not yet populated. |
| `carbonIntensity` | number \| null | gCO₂/kWh grid signal at that timestamp (PRD FR-SC-1). Same pass-through rule as `energyKwh`. |
| `carbonGco2` | number \| null | `energyKwh x carbonIntensity`. Same pass-through rule. |
| `baselineEnergyKwh` | number \| null | Static-provisioning baseline for the same interval. Same pass-through rule. |
| `baselineCarbonGco2` | number \| null | Static-provisioning baseline carbon for the same interval. Same pass-through rule. |

## `GET /api/metrics/savings`

Aggregates `ResourceUsage` over the full stored period into a single
AURA-vs-static-baseline savings summary (PRD FR-BE-7 / FR-SC-5).

**Response `200`**
```json
{
  "data": {
    "energySavedKwh": 412.6,
    "carbonSavedKg": 263.9,
    "costSaved": 38.5,
    "percentReduction": 19.8,
    "slaCompliancePct": 97.2
  }
}
```

| Field | Type | Notes |
|---|---|---|
| `energySavedKwh` | number | `sum(baselineEnergyKwh) - sum(energyKwh)` across all rows with both fields present |
| `carbonSavedKg` | number | `(sum(baselineCarbonGco2) - sum(carbonGco2)) / 1000` |
| `costSaved` | number | `sum(cost) * (percentReduction / 100)` — no `baselineCost` field exists in the schema, so this assumes cost scales proportionally with energy reduction. A backend-side convenience metric, not a substitute for the ML track's own cost analysis. |
| `percentReduction` | number | `energySavedKwh / sum(baselineEnergyKwh) * 100` |
| `slaCompliancePct` | number | Share of rows where `utilization <= 100` (capacity was not exceeded). **Placeholder** until the carbon-aware scheduler (Agrani + Prakul, PRD FR-SC-3/4) provides a real per-interval demand-met signal — documented as such in code, not presented as a final metric. |

Returns `0` for every field (not an error) if `ResourceUsage` has no rows with
energy/carbon data populated yet — this endpoint is designed to degrade gracefully
before the ML/scheduler track has written those fields.

## `GET /api/allocations`

Current state of tracked resources, from `Allocations` table.

**Response `200`**
```json
{
  "data": [
    {
      "resourceId": "ec2-01",
      "service": "EC2",
      "status": "active",
      "capacity": 80
    }
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `resourceId` | string | Partition key of `Allocations` |
| `service` | string | e.g. `"EC2"`, `"Lambda"` |
| `status` | string | `"active"` \| `"idle"` \| `"stopped"` |
| `capacity` | number | Percent, 0–100 |

## `POST /api/allocations/scale`

Triggers a scaling action: updates `Allocations`, invokes the scaling Lambda,
publishes an SNS alert, and logs a CloudWatch metric.

**Request**
```json
{
  "resourceId": "ec2-01",
  "action": "scale_down",
  "targetCapacity": 40
}
```

| Field | Type | Notes |
|---|---|---|
| `resourceId` | string | Must exist in `Allocations` |
| `action` | string | `"scale_up"` \| `"scale_down"` \| `"maintain"` |
| `targetCapacity` | number | 0–100 |

**Response `200`**
```json
{
  "success": true,
  "message": "Scaling action initiated",
  "newCapacity": 40
}
```

**Response `400`** — invalid `resourceId` or out-of-range `targetCapacity`:
```json
{ "success": false, "message": "Invalid resourceId" }
```

## `GET /api/alerts`

Alert feed from `Alerts` table, sorted by `timestamp` descending.

**Response `200`**
```json
{
  "data": [
    {
      "timestamp": "2026-08-01T00:00:00Z",
      "type": "scaling",
      "message": "Scaled down EC2 during low demand",
      "severity": "info"
    }
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `alertId` | string, UUID | Partition key of `Alerts` (not returned to frontend, internal only) |
| `timestamp` | string, ISO 8601 | Sort key of `Alerts` |
| `type` | string | e.g. `"scaling"`, `"health"` |
| `message` | string | Human-readable |
| `severity` | string | `"info"` \| `"warning"` \| `"critical"` |

## ML Service Integration (internal, not exposed to frontend)

Backend calls the ML service directly — not proxied through a public route.

```
GET {ML_SERVICE_URL}/predict?n_steps=12
```

**Response**
```json
{
  "status": "ok",
  "n_steps": 12,
  "predictions": [
    {
      "timestamp": "2026-08-01T14:05:00Z",
      "predicted_utilization": 72.4,
      "scaling_recommendation": "maintain"
    }
  ]
}
```

`GET /api/metrics/energy` merges `predicted_utilization` into the `predicted`
field of matching timestamps. If the ML service is unreachable, the backend
falls back to `DynamoDB`-only data with `predicted: null` — it never fails
the request.

## Carbon-aware scheduler integration (internal, PRD FR-SC-3/4)

Per PRD section 6.2, the backend's `scaling-handler` Lambda
(`src/aws/lambda/scaling-handler/`) is a **thin wrapper** that invokes the ML
track's carbon-aware scheduler logic (owned by Agrani; deferrable/non-deferrable
classification, deadline-aware deferral to lower-carbon windows) rather than
implementing that logic itself. It calls:

```
GET {SCHEDULER_SERVICE_URL}/schedule?resourceId=...&action=...&targetCapacity=...
```

**Expected response** (shape provisional — locked once the scheduler track
publishes its own contract):
```json
{
  "decision": "defer" | "proceed",
  "deferredUntil": "2026-08-01T02:00:00Z",
  "reason": "low-carbon window within deadline"
}
```

If `SCHEDULER_SERVICE_URL` is unset or unreachable, the Lambda falls back to
immediate simulated execution (its pre-scheduler behavior) and logs that the
scheduler was bypassed — scaling actions are never blocked by scheduler
unavailability.

## Error shape (all routes)

```json
{ "error": "<message>" }
```
