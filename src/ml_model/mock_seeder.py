import json
import math
import os
import random
import uuid
from datetime import datetime, timedelta, timezone

RANDOM_SEED = 42
random.seed(RANDOM_SEED)

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "mock_data")
os.makedirs(OUTPUT_DIR, exist_ok=True)

BASE_TS = datetime(2026, 8, 1, 0, 0, 0, tzinfo=timezone.utc)
INTERVAL_MINUTES = 60


def _academic_multiplier(dt: datetime) -> float:
    month = dt.month
    hour = dt.hour
    weekday = dt.weekday()

    if month in (12, 1, 5, 6):
        return 0.5
    if month in (11, 4):
        return 1.4
    if month in (8, 2) and dt.day <= 14:
        return 1.3
    if weekday >= 5:
        return 0.7
    if 9 <= hour < 17:
        return 1.15
    return 1.0


def generate_energy_metrics(n: int = 120) -> list[dict]:
    records = []
    for i in range(n):
        ts = BASE_TS + timedelta(hours=i)
        mult = _academic_multiplier(ts)

        hour_angle = 2 * math.pi * (ts.hour / 24)
        base_util = 40 + 25 * math.sin(hour_angle - math.pi / 2)

        actual = round(min(100, max(5, base_util * mult + random.gauss(0, 3))), 2)
        predicted = round(min(100, max(5, base_util * mult + random.gauss(0, 1.5))), 2)
        cost = round(actual * 0.055 + random.gauss(0, 0.2), 2)

        records.append(
            {
                "timestamp": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "utilization": actual,
                "cost": max(0.01, cost),
                "predicted": predicted,
            }
        )
    return records


SERVICES = ["EC2", "EC2", "Lambda", "RDS", "ElastiCache"]
STATUSES = ["active", "active", "active", "idle", "stopped"]
CAPACITIES = [80, 65, 90, 40, 0]


def generate_allocations() -> list[dict]:
    records = []
    for idx in range(5):
        records.append(
            {
                "resourceId": f"ec2-0{idx + 1}" if SERVICES[idx] == "EC2" else f"{SERVICES[idx].lower()}-0{idx + 1}",
                "service": SERVICES[idx],
                "status": STATUSES[idx],
                "capacity": CAPACITIES[idx],
            }
        )
    return records


ALERT_TEMPLATES = [
    ("scaling",   "Scaled down EC2 during low demand",                    "info"),
    ("scaling",   "Scaled up EC2 - predicted exam-week surge",            "warning"),
    ("cost",      "Hourly cost exceeded $5.00 threshold",                 "warning"),
    ("carbon",    "Deferred batch jobs - off-peak carbon window active",  "info"),
    ("health",    "EC2 instance health check failed, replaced automatically", "critical"),
    ("scaling",   "Lambda concurrency at 80% - auto-scaling triggered",   "warning"),
    ("cost",      "Daily spend on track: $0.00 (Free Tier)",              "info"),
    ("carbon",    "Carbon footprint reduced 12% vs last week",            "info"),
    ("health",    "RDS connection pool exhausted, cleared idle sessions", "warning"),
    ("scaling",   "Scaled down RDS read replica during weekend break",    "info"),
    ("cost",      "Cost spike detected - investigating cause",            "critical"),
    ("carbon",    "Batch job deferred to 02:00 AM low-carbon window",     "info"),
    ("scaling",   "Scaled EC2 to 40% capacity - semester recess detected", "info"),
    ("health",    "CloudWatch alarm: CPU > 85% sustained for 10 minutes", "warning"),
    ("scaling",   "Prediction confidence low - maintaining current allocation", "info"),
    ("cost",      "SNS alert: monthly budget threshold at 80%",           "warning"),
    ("carbon",    "Green scheduling: 3 batch jobs deferred tonight",      "info"),
    ("health",    "DynamoDB read throttling - increasing RCU temporarily","warning"),
    ("scaling",   "Semester start: pre-scaling EC2 to 80% capacity",      "info"),
    ("health",    "All systems nominal",                                   "info"),
]


def generate_alerts(n: int = 20) -> list[dict]:
    records = []
    for i in range(n):
        ts = BASE_TS + timedelta(hours=random.randint(0, 119))
        template = ALERT_TEMPLATES[i % len(ALERT_TEMPLATES)]
        records.append(
            {
                "timestamp": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "type": template[0],
                "message": template[1],
                "severity": template[2],
            }
        )
    records.sort(key=lambda r: r["timestamp"], reverse=True)
    return records


def write_json(data: list | dict, filename: str) -> None:
    path = os.path.join(OUTPUT_DIR, filename)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(f"  Written {len(data) if isinstance(data, list) else 1} record(s) -> {path}")


def main() -> None:
    print("\nAURA Mock Data Seeder")
    print("=" * 40)

    energy = generate_energy_metrics(120)
    allocations = generate_allocations()
    alerts = generate_alerts(20)

    write_json({"data": energy},      "energy_metrics.json")
    write_json({"data": allocations}, "allocations.json")
    write_json({"data": alerts},      "alerts.json")

    print("\nDone! Share src/ml_model/mock_data/ with Pranav and Prakul.")
    print("Pranav: import JSON in api.js for Phase 1 mock rendering.")
    print("Prakul: use JSON to seed DynamoDB tables.\n")


if __name__ == "__main__":
    main()
