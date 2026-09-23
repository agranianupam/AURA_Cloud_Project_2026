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

_MODEL_DIR = Path(os.getenv("SM_MODEL_DIR", "/opt/ml/model"))


def model_fn(model_dir: str) -> dict:
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

    if str(model_dir_path) not in sys.path:
        sys.path.insert(0, str(model_dir_path))

    return {"model": model, "scaler": scaler}


def input_fn(request_body: str, content_type: str = "application/json") -> dict:
    if content_type != "application/json":
        raise ValueError(f"Unsupported content type: {content_type}")
    data = json.loads(request_body)
    n_steps = int(data.get("n_steps", 12))
    n_steps = max(1, min(n_steps, 288))
    return {"n_steps": n_steps}


def predict_fn(input_data: dict, model_artifacts: dict) -> list[dict]:
    from datetime import datetime, timedelta, timezone

    import numpy as np

    model  = model_artifacts["model"]
    scaler = model_artifacts.get("scaler")
    n_steps_in  = 24
    n_steps_out = input_data["n_steps"]

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
    return json.dumps({"status": "ok", "predictions": predictions})


def deploy_endpoint(
    s3_model_uri: str,
    role_arn: str,
    endpoint_name: str = "aura-ml-endpoint",
    instance_type: str = "ml.t2.medium",
) -> str:
    import boto3

    sm = boto3.client("sagemaker", region_name=os.getenv("AWS_REGION", "ap-south-1"))

    model_name  = f"{endpoint_name}-model"
    config_name = f"{endpoint_name}-config"

    sm.create_model(
        ModelName=model_name,
        PrimaryContainer={
            "Image": _get_tf_inference_image(),
            "ModelDataUrl": s3_model_uri,
            "Environment": {"SAGEMAKER_PROGRAM": "sagemaker_inference.py"},
        },
        ExecutionRoleArn=role_arn,
    )

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

    sm.create_endpoint(EndpointName=endpoint_name, EndpointConfigName=config_name)
    logger.info(f"Endpoint creation initiated: {endpoint_name}")
    return endpoint_name


def delete_endpoint(endpoint_name: str = "aura-ml-endpoint") -> None:
    import boto3

    sm = boto3.client("sagemaker", region_name=os.getenv("AWS_REGION", "ap-south-1"))

    for delete_fn, kwargs in [
        (sm.delete_endpoint,        {"EndpointName": endpoint_name}),
        (sm.delete_endpoint_config, {"EndpointConfigName": f"{endpoint_name}-config"}),
        (sm.delete_model,           {"ModelName": f"{endpoint_name}-model"}),
    ]:
        try:
            delete_fn(**kwargs)
        except Exception as e:
            logger.warning(f"Could not delete: {e}")

    logger.info(f"Endpoint {endpoint_name} deleted.")


def test_endpoint(endpoint_name: str = "aura-ml-endpoint", n_steps: int = 12) -> None:
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
    region = os.getenv("AWS_REGION", "ap-south-1")
    return (
        f"763104351884.dkr.ecr.{region}.amazonaws.com/"
        "tensorflow-inference:2.15-cpu-py311-ubuntu20.04-sagemaker"
    )


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="AURA SageMaker endpoint manager")
    parser.add_argument("action", choices=["deploy", "delete", "test"])
    parser.add_argument("--s3-uri",   help="S3 URI for model.tar.gz")
    parser.add_argument("--role-arn", help="IAM role ARN")
    parser.add_argument("--endpoint", default="aura-ml-endpoint")
    parser.add_argument("--n-steps",  type=int, default=12)
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
