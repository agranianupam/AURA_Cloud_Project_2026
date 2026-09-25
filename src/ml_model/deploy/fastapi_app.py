from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Optional

_ml_dir = Path(__file__).resolve().parents[1]
if str(_ml_dir) not in sys.path:
    sys.path.insert(0, str(_ml_dir))

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from predict import predict
from scheduler import schedule_workload, Workload
from datetime import datetime, timezone, timedelta

app = FastAPI(
    title="AURA ML Prediction Service",
    description="LSTM-based demand forecasting for university data center resource allocation.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        os.getenv("FRONTEND_ORIGIN", "*"),
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PredictionRequest(BaseModel):
    n_steps: int = Field(default=12, ge=1, le=288)


class PredictionEntry(BaseModel):
    timestamp: str
    predicted_utilization: float
    provisioned_capacity_pct: float
    scaling_recommendation: str
    carbon_intensity: float
    energy_kwh: float
    carbon_gco2: float
    baseline_energy_kwh: float
    baseline_carbon_gco2: float


class PredictionResponse(BaseModel):
    status: str
    n_steps: int
    predictions: list[PredictionEntry]


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    message: str


@app.get("/", tags=["Meta"])
def root():
    return {
        "service": "AURA ML Prediction Service",
        "version": "1.0.0",
        "docs": "/docs",
    }


@app.get("/health", response_model=HealthResponse, tags=["Meta"])
def health():
    model_path = _ml_dir / "model_weights.keras"
    loaded = model_path.exists()
    return HealthResponse(
        status="ok" if loaded else "degraded",
        model_loaded=loaded,
        message="Model ready." if loaded else "Model weights not found. Train the model first.",
    )


@app.get("/predict", response_model=PredictionResponse, tags=["Prediction"])
def get_predictions(
    n_steps: int = Query(default=12, ge=1, le=288)
):
    try:
        results = predict(n_steps=n_steps)
        return PredictionResponse(
            status="ok",
            n_steps=n_steps,
            predictions=[PredictionEntry(**r) for r in results],
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")


@app.post("/predict", response_model=PredictionResponse, tags=["Prediction"])
def post_predictions(body: PredictionRequest):
    return get_predictions(n_steps=body.n_steps)


class ScheduleDecisionResponse(BaseModel):
    workload_id: str
    decision: str
    scheduled_at: str
    reason: str
    deferredUntil: Optional[str] = None


@app.get("/schedule", response_model=ScheduleDecisionResponse, tags=["Scheduler"])
def get_schedule(
    resourceId: str = Query(..., description="ID of the workload/resource"),
    action: str = Query(..., description="Requested scaling action (e.g., scale_up, run_batch)"),
    targetCapacity: str = Query(..., description="Target capacity %"),
):
    """
    Carbon-aware scheduling endpoint. Called by the backend scaling-handler Lambda.
    """
    now = datetime.now(tz=timezone.utc)
    
    # Simple mapping of action to workload type for demo purposes
    # In a real system, the workload type would be passed explicitly
    workload_type = "batch" if "batch" in action.lower() or "defer" in action.lower() else "lms"
    
    try:
        util_pct = float(targetCapacity)
    except ValueError:
        util_pct = 50.0

    # Create a workload (assumes 1 hour duration and a deadline 12 hours from now)
    wl = Workload(
        workload_id=resourceId,
        workload_type=workload_type,
        deadline=now + timedelta(hours=12),
        duration_hours=1.0,
        avg_utilization_pct=util_pct,
    )
    
    decision = schedule_workload(wl, now=now)
    
    return ScheduleDecisionResponse(
        workload_id=decision.workload_id,
        decision=decision.decision,
        scheduled_at=decision.scheduled_at.isoformat() if decision.scheduled_at else now.isoformat(),
        reason=decision.reason,
        deferredUntil=decision.scheduled_at.isoformat() if decision.decision == "defer" and decision.scheduled_at else None,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("fastapi_app:app", host="0.0.0.0", port=8000, reload=True)
