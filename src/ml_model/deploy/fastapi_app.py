"""
AURA — FastAPI Prediction Service
===================================
Local ML microservice that exposes the LSTM prediction interface over HTTP.
The backend (Prakul) calls this service at ML_SERVICE_URL (default: http://localhost:8000).

Start:
  uvicorn src.ml_model.deploy.fastapi_app:app --reload --port 8000

  OR from inside src/ml_model/deploy/:
  uvicorn fastapi_app:app --reload --port 8000

Endpoints:
  GET  /                       — health check
  GET  /predict?n_steps=12     — run LSTM forecast
  GET  /health                 — detailed health (model loaded?)
  POST /predict                — same as GET but accepts JSON body

CORS: configured to allow the frontend origin (VITE_API_BASE_URL).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Optional

# Allow running from any working directory
_ml_dir = Path(__file__).resolve().parents[1]
if str(_ml_dir) not in sys.path:
    sys.path.insert(0, str(_ml_dir))

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from predict import predict   # noqa: E402  (after sys.path patch)

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="AURA ML Prediction Service",
    description="LSTM-based demand forecasting for university data center resource allocation.",
    version="1.0.0",
)

# CORS — allow frontend + backend origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",   # Vite dev server (Pranav)
        "http://localhost:3000",   # Express backend (Prakul)
        os.getenv("FRONTEND_ORIGIN", "*"),
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Schemas ───────────────────────────────────────────────────────────────────

class PredictionRequest(BaseModel):
    n_steps: int = Field(default=12, ge=1, le=288, description="Number of 5-min steps to forecast")


class PredictionEntry(BaseModel):
    timestamp: str
    predicted_utilization: float
    scaling_recommendation: str


class PredictionResponse(BaseModel):
    status: str
    n_steps: int
    predictions: list[PredictionEntry]


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    message: str


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/", tags=["Meta"])
def root():
    return {
        "service": "AURA ML Prediction Service",
        "version": "1.0.0",
        "docs": "/docs",
    }


@app.get("/health", response_model=HealthResponse, tags=["Meta"])
def health():
    model_path = _ml_dir / "model_weights.h5"
    loaded = model_path.exists()
    return HealthResponse(
        status="ok" if loaded else "degraded",
        model_loaded=loaded,
        message="Model ready." if loaded else "Model weights not found. Train the model first.",
    )


@app.get("/predict", response_model=PredictionResponse, tags=["Prediction"])
def get_predictions(
    n_steps: int = Query(default=12, ge=1, le=288, description="Number of 5-min steps to forecast")
):
    """
    Run the LSTM rolling forecast and return n_steps predictions.
    Each step represents 5 minutes into the future.
    """
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
    """Same as GET /predict but accepts a JSON body (useful for Prakul's backend)."""
    return get_predictions(n_steps=body.n_steps)


# ── Dev entry point ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("fastapi_app:app", host="0.0.0.0", port=8000, reload=True)
