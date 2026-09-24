# AURA — DynamoDB Schema

Three tables, all on-demand billing (stays inside Always Free tier at this scale).

## `ResourceUsage`

Historical + predicted energy/utilization/carbon readings. Feeds
`GET /api/metrics/energy` and `GET /api/metrics/savings`.

| Attribute | Type | Key |
|---|---|---|
| `timestamp` | String (ISO 8601) | Partition key |
| `utilization` | Number | |
| `cost` | Number | |
| `predicted` | Number | Written by backend after merging ML service output; `null` if unavailable |
| `energyKwh` | Number | Modelled estimate. **Owned by the ML/scheduler track** (power model, PRD FR-SC-2) — the backend never computes this, only reads/passes it through. Absent or `null` until that track writes it. |
| `carbonIntensity` | Number | gCO₂/kWh grid signal (PRD FR-SC-1). Same ownership as `energyKwh`. |
| `carbonGco2` | Number | `energyKwh x carbonIntensity`. Same ownership as `energyKwh`. |
| `baselineEnergyKwh` | Number | Static-provisioning baseline for the same interval. Same ownership as `energyKwh`. |
| `baselineCarbonGco2` | Number | Static-provisioning baseline carbon. Same ownership as `energyKwh`. |

No sort key — one reading per timestamp is sufficient at 5-minute/hourly granularity
for this project's scale. The five energy/carbon attributes are additive to the
existing item shape — DynamoDB is schemaless beyond the key, so no table migration
is needed; older rows simply won't have them until re-seeded.

## `Allocations`

Current state of each tracked cloud resource. Feeds `GET /api/allocations` and is
mutated by `POST /api/allocations/scale`.

| Attribute | Type | Key |
|---|---|---|
| `resourceId` | String | Partition key |
| `service` | String | e.g. `"EC2"`, `"Lambda"` |
| `status` | String | `"active"` \| `"idle"` \| `"stopped"` |
| `capacity` | Number | 0–100 |
| `lastUpdated` | String (ISO 8601) | Set on every scale action |

## `Alerts`

Event log for scaling actions, health events, etc. Feeds `GET /api/alerts`.

| Attribute | Type | Key |
|---|---|---|
| `alertId` | String (UUID) | Partition key |
| `timestamp` | String (ISO 8601) | Sort key |
| `type` | String | e.g. `"scaling"`, `"health"` |
| `message` | String | |
| `severity` | String | `"info"` \| `"warning"` \| `"critical"` |

Sorted by `timestamp` descending at query time (`ScanIndexForward: false`) since
alerts are read far more often than filtered by a specific `alertId`.

## Access patterns

| Query | Table | Operation |
|---|---|---|
| List recent usage/predictions | `ResourceUsage` | `Scan` (small table; swap to a GSI on a constant partition + `timestamp` range if this grows) |
| Aggregate savings (`/api/metrics/savings`) | `ResourceUsage` | `Scan` + in-application sum/reduce over `energyKwh`/`carbonGco2`/baseline fields — same table, no extra index needed at this scale |
| List all allocations | `Allocations` | `Scan` (only ~5 items) |
| Get/update one allocation | `Allocations` | `GetItem` / `UpdateItem` on `resourceId` |
| List alerts, newest first | `Alerts` | `Query` would need a constant partition key to sort by `timestamp` across items; at this scale we `Scan` + sort in application code instead |

## Provisioning

Created by `src/aws/scripts/setup.sh` with `--billing-mode PAY_PER_REQUEST` (on-demand,
no RCU/WCU to manage, stays inside DynamoDB's Always Free 25 GB allowance for this
project's data volume).
