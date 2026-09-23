from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_task_dir = Path(__file__).resolve().parent
for _p in [str(_task_dir), str(_task_dir.parent)]:
    if _p not in sys.path:
        sys.path.insert(0, _p)

predict_fn = None


def _get_predict():
    global predict_fn
    if predict_fn is None:
        logger.info("Cold start: loading model ...")
        from predict import predict
        predict_fn = predict
        logger.info("Model loaded successfully.")
    return predict_fn


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


def handler(event: dict, context) -> dict:
    http_method = event.get("httpMethod", "GET").upper()
    logger.info(f"Invoked: method={http_method}")

    if http_method == "OPTIONS":
        return _ok({})

    n_steps = 12
    try:
        if http_method == "GET":
            qs = event.get("queryStringParameters") or {}
            n_steps = int(qs.get("n_steps", 12))
        else:
            body_raw = event.get("body") or "{}"
            body = json.loads(body_raw) if isinstance(body_raw, str) else body_raw
            n_steps = int(body.get("n_steps", 12))

        n_steps = max(1, min(n_steps, 288))
    except (ValueError, TypeError) as e:
        return _err(f"Invalid n_steps: {e}", status=400)

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
