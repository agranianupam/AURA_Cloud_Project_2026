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

Historical utilization/cost readings from DynamoDB (`ResourceUsage` table), merged
with predicted values from the ML service where available.

**Response `200`**
```json
{
  "data": [
    {
      "timestamp": "2026-08-01T00:00:00Z",
      "utilization": 62.3,
      "cost": 4.12,
      "predicted": 65.0
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

## Error shape (all routes)

```json
{ "error": "<message>" }
```
