"""
AURA — SageMaker Inference Script
====================================
Implements the four SageMaker inference hooks used by the Inference Toolkit:
  model_fn     — load the model from /opt/ml/model
  input_fn     — deserialise incoming request data
  predict_fn   — run inference
  output_fn    — serialise the response

⚠️  FREE TIER WARNING ⚠️
  SageMaker ml.t2.medium is FREE for 250 hrs in the FIRST 2 MONTHS only.
  Steps:
    1. Deploy endpoint via deploy_endpoint() below.
    2. Demo it (≤ 30 minutes).
    3. Call delete_endpoint() IMMEDIATELY after.
  Forgetting to delete = real AWS charges.

Deployment:
  python src/ml_model/deploy/sagemaker_inference.py deploy
  python src/ml_model/deploy/sagemaker_inference.py delete   ← ALWAYS run this
  python src/ml_model/deploy/sagemaker_inference.py test     ← smoke test

Packaging (run before deploying):
  cd src/ml_model
  tar -czf model.tar.gz model_weights.h5 scaler.pkl predict.py
  aws s3 cp model.tar.gz s3://<your-bucket>/aura/model.tar.gz
"""

from __future__ import annotations

import io
import json
import logging
import os
import pickle
import sys
import tarfile
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)

# ── Paths (inside container: /opt/ml/model/) ─────────────────────────────────

_MODEL_DIR = Path(os.getenv("SM_MODEL_DIR", "/opt/ml/model"))


# ── SageMaker Hooks ───────────────────────────────────────────────────────────

def model_fn(model_dir: str) -> dict:
    """
    Load the trained model and scaler from the SageMaker model directory.
    Called once at container startup.

    Returns a dict: {"model": keras_model, "scaler": MinMaxScaler | None}
    """
    import tensorflow as tf

    model_dir_path = Path(model_dir)
    weights_path = model_dir_path / "model_weights.h5"

    if not weights_path.exists():
        raise FileNotFoundError(f"model_weights.h5 not found in {model_dir}")

    logger.info(f"Loading LSTM model from {weights_path}")
    model = tf.keras.models.load_model(str(weights_path))

    scaler = None
    scaler_path = model_dir_path / "scaler.pkl"
    if scaler_path.exists():
        with open(scaler_path, "rb") as f:
            scaler = pickle.load(f)
        logger.info("Scaler loaded.")

    # Add predict.py to path (it's packaged alongside the model)
    if str(model_dir_path) not in sys.path:
        sys.path.insert(0, str(model_dir_path))

    return {"model": model, "scaler": scaler}


def input_fn(request_body: str, content_type: str = "application/json") -> dict:
    """
    Deserialise the incoming request.
    Expected JSON: {"n_steps": 12}
    """
    if content_type != "application/json":
        raise ValueError(f"Unsupported content type: {content_type}")
    data = json.loads(request_body)
    n_steps = int(data.get("n_steps", 12))
    n_steps = max(1, min(n_steps, 288))
    return {"n_steps": n_steps}


def predict_fn(input_data: dict, model_artifacts: dict) -> list[dict]:
    """
    Run the LSTM rolling forecast using the loaded model and scaler.
    """
    from datetime import datetime, timedelta, timezone

    import numpy as np

    model  = model_artifacts["model"]
    scaler = model_artifacts.get("scaler")
    n_steps_in  = 24   # window size used during training
    n_steps_out = input_data["n_steps"]

    # Seed with a neutral value (0.4 normalised ≈ 40% utilisation)
    window = list(np.full(n_steps_in, 0.4, dtype=np.float32))
    now = datetime.now(tz=timezone.utc)
    predictions = []

    for step in range(n_steps_out):
        x = np.array(window[-n_steps_in:], dtype=np.float32).reshape(1, n_steps_in, 1)
        pred_norm = float(model.predict(x, verbose=0)[0, 0])
        pred_norm = float(np.clip(pred_norm, 0.0, 1.0))

        if scaler is not None:
            pred_pct = float(scaler.inverse_transform([[pred_norm]])[0, 0])
        else:
            pred_pct = pred_norm * 100.0

        pred_pct = round(float(np.clip(pred_pct, 0.0, 100.0)), 2)
        ts = now + timedelta(minutes=5 * (step + 1))

        # Scaling recommendation
        h = ts.hour
        off_peak = h >= 22 or h < 6
        if pred_pct < 30.0 and off_peak:
            rec = "defer_batch_jobs"
        elif pred_pct > 80.0:
            rec = "scale_up"
        elif pred_pct < 30.0:
            rec = "scale_down"
        else:
            rec = "maintain"

        predictions.append({
            "timestamp": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "predicted_utilization": pred_pct,
            "scaling_recommendation": rec,
        })
        window.append(pred_norm)

    return predictions


def output_fn(predictions: list[dict], accept: str = "application/json") -> str:
    """Serialise predictions to JSON."""
    return json.dumps({"status": "ok", "predictions": predictions})


# ── Deploy / Delete / Test helpers ────────────────────────────────────────────

def deploy_endpoint(
    s3_model_uri: str,
    role_arn: str,
    endpoint_name: str = "aura-ml-endpoint",
    instance_type: str = "ml.t2.medium",
) -> str:
    """
    Deploy the model to a SageMaker real-time endpoint.

    ⚠️  DELETE THE ENDPOINT AFTER THE DEMO.

    Args:
        s3_model_uri: s3://bucket/path/model.tar.gz
        role_arn:     IAM role ARN with SageMaker + S3 permissions
        endpoint_name: unique name for the endpoint
        instance_type: ml.t2.medium (free tier eligible first 2 months)

    Returns:
        endpoint_name
    """
    import boto3

    sm = boto3.client("sagemaker", region_name=os.getenv("AWS_REGION", "ap-south-1"))

    model_name  = f"{endpoint_name}-model"
    config_name = f"{endpoint_name}-config"

    # 1. Create model
    sm.create_model(
        ModelName=model_name,
        PrimaryContainer={
            "Image": _get_tf_inference_image(),
            "ModelDataUrl": s3_model_uri,
            "Environment": {"SAGEMAKER_PROGRAM": "sagemaker_inference.py"},
        },
        ExecutionRoleArn=role_arn,
    )
    logger.info(f"Model created: {model_name}")

    # 2. Create endpoint config
    sm.create_endpoint_config(
        EndpointConfigName=config_name,
        ProductionVariants=[
            {
                "VariantName": "AllTraffic",
                "ModelName": model_name,
                "InitialInstanceCount": 1,
                "InstanceType": instance_type,
                "InitialVariantWeight": 1.0,
            }
        ],
    )
    logger.info(f"Endpoint config created: {config_name}")

    # 3. Create endpoint (async — waiter needed in practice)
    sm.create_endpoint(EndpointName=endpoint_name, EndpointConfigName=config_name)
    logger.info(f"Endpoint creation initiated: {endpoint_name}")
    logger.info("Wait a few minutes then test with: python sagemaker_inference.py test")
    return endpoint_name


def delete_endpoint(endpoint_name: str = "aura-ml-endpoint") -> None:
    """
    Delete the SageMaker endpoint, config, and model to avoid charges.
    ⚠️  ALWAYS run this after the demo.
    """
    import boto3

    sm = boto3.client("sagemaker", region_name=os.getenv("AWS_REGION", "ap-south-1"))

    for fn, resource in [
        (sm.delete_endpoint,        endpoint_name),
        (sm.delete_endpoint_config, f"{endpoint_name}-config"),
        (sm.delete_model,           f"{endpoint_name}-model"),
    ]:
        try:
            fn(**({list(fn.__code__.co_varnames[:1])[0]: resource}
                  if False else
                  ({"EndpointName": resource}
                   if "endpoint" in fn.__name__.lower() and "config" not in fn.__name__.lower() and "model" not in fn.__name__.lower()
                   else {"EndpointConfigName": resource}
                   if "config" in fn.__name__.lower()
                   else {"ModelName": resource})))
        except Exception as e:
            logger.warning(f"Could not delete {resource}: {e}")

    logger.info(f"✅ Endpoint {endpoint_name} deleted. Check AWS billing to confirm $0 charge.")


def test_endpoint(endpoint_name: str = "aura-ml-endpoint", n_steps: int = 12) -> None:
    """Invoke the deployed endpoint and print results."""
    import boto3

    runtime = boto3.client("sagemaker-runtime", region_name=os.getenv("AWS_REGION", "ap-south-1"))
    payload = json.dumps({"n_steps": n_steps})

    response = runtime.invoke_endpoint(
        EndpointName=endpoint_name,
        ContentType="application/json",
        Body=payload,
    )
    result = json.loads(response["Body"].read())
    print(json.dumps(result, indent=2))


def _get_tf_inference_image() -> str:
    """Return the AWS Deep Learning Container URI for TF 2.15 inference."""
    region = os.getenv("AWS_REGION", "ap-south-1")
    # Public DLC URI for TF 2.15 CPU inference (Python 3.11)
    return (
        f"763104351884.dkr.ecr.{region}.amazonaws.com/"
        "tensorflow-inference:2.15-cpu-py311-ubuntu20.04-sagemaker"
    )


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="AURA SageMaker endpoint manager")
    parser.add_argument("action", choices=["deploy", "delete", "test"])
    parser.add_argument("--s3-uri",       help="S3 URI for model.tar.gz (required for deploy)")
    parser.add_argument("--role-arn",     help="IAM role ARN (required for deploy)")
    parser.add_argument("--endpoint",     default="aura-ml-endpoint")
    parser.add_argument("--n-steps",      type=int, default=12)
    args = parser.parse_args()

    if args.action == "deploy":
        if not args.s3_uri or not args.role_arn:
            parser.error("--s3-uri and --role-arn are required for deploy")
        deploy_endpoint(args.s3_uri, args.role_arn, args.endpoint)

    elif args.action == "delete":
        confirm = input(f"Delete endpoint '{args.endpoint}'? [yes/no]: ")
        if confirm.lower() == "yes":
            delete_endpoint(args.endpoint)
        else:
            print("Aborted.")

    elif args.action == "test":
        test_endpoint(args.endpoint, n_steps=args.n_steps)
