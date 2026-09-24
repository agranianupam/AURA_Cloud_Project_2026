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
    scaling_recommendation: str


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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("fastapi_app:app", host="0.0.0.0", port=8000, reload=True)
