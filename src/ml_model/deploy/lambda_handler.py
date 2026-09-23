"""
AURA — AWS Lambda Handler
===========================
Wraps the LSTM predict() interface for deployment as an AWS Lambda function.

Lambda event format (API Gateway proxy integration):
  {
    "queryStringParameters": { "n_steps": "12" },   ← GET
    "body": "{\"n_steps\": 12}"                      ← POST (JSON string)
  }

Response:
  Standard API Gateway proxy response with CORS headers.

Deployment notes:
  1. Package the Lambda with its dependencies:
       pip install -r src/ml_model/requirements.txt -t lambda_pkg/
       cp src/ml_model/*.py lambda_pkg/
       cp src/ml_model/model_weights.h5 lambda_pkg/
       cp src/ml_model/scaler.pkl lambda_pkg/
       cd lambda_pkg && zip -r ../aura_ml.zip .
  2. Upload aura_ml.zip to Lambda (runtime: python3.11).
  3. Handler: lambda_handler.handler
  4. Memory: 512 MB+  (TensorFlow at inference is ~300 MB)
  5. Timeout: 30 s (cold start with TF can be ~15 s)
  6. Free Tier: 1 M requests/month, 400 K GB-seconds — well within limits.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# ── Path fix for Lambda runtime ───────────────────────────────────────────────
# In the Lambda container, all files land in /var/task/. We also add the
# parent for local testing where the package structure still exists.
_task_dir = Path(__file__).resolve().parent
for _p in [str(_task_dir), str(_task_dir.parent)]:
    if _p not in sys.path:
        sys.path.insert(0, _p)

# Lazy import — TF is large; only import at cold-start (first invocation)
predict_fn = None


def _get_predict():
    global predict_fn
    if predict_fn is None:
        logger.info("Cold start: loading model ...")
        from predict import predict   # noqa
        predict_fn = predict
        logger.info("Model loaded successfully.")
    return predict_fn


# ── CORS headers ──────────────────────────────────────────────────────────────

_CORS_HEADERS = {
    "Access-Control-Allow-Origin":  os.getenv("ALLOWED_ORIGIN", "*"),
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Content-Type": "application/json",
}


def _ok(body: dict, status: int = 200) -> dict:
    return {
        "statusCode": status,
        "headers": _CORS_HEADERS,
        "body": json.dumps(body),
    }


def _err(message: str, status: int = 500) -> dict:
    return {
        "statusCode": status,
        "headers": _CORS_HEADERS,
        "body": json.dumps({"error": message}),
    }


# ── Handler ───────────────────────────────────────────────────────────────────

def handler(event: dict, context) -> dict:
    """
    AWS Lambda entry point.

    Supports:
      GET  ?n_steps=12
      POST {"n_steps": 12}
      OPTIONS (CORS preflight)
    """
    http_method = event.get("httpMethod", "GET").upper()
    logger.info(f"Invoked: method={http_method}")

    # CORS preflight
    if http_method == "OPTIONS":
        return _ok({})

    # Parse n_steps
    n_steps = 12   # default
    try:
        if http_method == "GET":
            qs = event.get("queryStringParameters") or {}
            n_steps = int(qs.get("n_steps", 12))
        else:
            body_raw = event.get("body") or "{}"
            body = json.loads(body_raw) if isinstance(body_raw, str) else body_raw
            n_steps = int(body.get("n_steps", 12))

        n_steps = max(1, min(n_steps, 288))   # clamp
    except (ValueError, TypeError) as e:
        return _err(f"Invalid n_steps: {e}", status=400)

    # Run prediction
    try:
        predict = _get_predict()
        predictions = predict(n_steps=n_steps)
        logger.info(f"Generated {len(predictions)} predictions")
        return _ok(
            {
                "status": "ok",
                "n_steps": n_steps,
                "predictions": predictions,
            }
        )
    except FileNotFoundError as e:
        logger.error(f"Model not found: {e}")
        return _err(str(e), status=503)
    except Exception as e:
        logger.exception("Prediction error")
        return _err(f"Prediction failed: {str(e)}", status=500)
