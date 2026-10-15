"""Long-running worker for the Node API: loads the LSTM once, then answers JSON-line requests on stdin.

Request:  {"id": 1, "method": "simulate" | "preview" | "upload" | "info", "params": {...}}
Response: {"id": 1, "ok": true, "result": {...}}
       or {"id": 1, "ok": false, "error": {"type": "validation" | "csv" | "too_large" | "internal", "message": "...", "field": "..."}}
A {"ready": true} line is written once the model is loaded. Anything else printed (TensorFlow logs) goes to stderr.
"""
import json
import os
import sys
import traceback

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
_out = sys.stdout
sys.stdout = sys.stderr  # keep stdout clean for the protocol

from engine import Engine, ValidationError  # noqa: E402


def handle(engine, method, params):
    if method == "simulate":
        return engine.simulate(params)
    if method == "preview":
        return engine.preview(params.get("date"), params.get("dataset"))
    if method == "upload":
        return engine.upload_and_simulate(params.get("csv"), params.get("name"), params.get("params"))
    if method == "info":
        return engine.info()
    raise ValidationError(f"unknown method '{method}'", "method")


def send(obj):
    _out.write(json.dumps(obj, allow_nan=False) + "\n")
    _out.flush()


def main():
    engine = Engine()
    send({"ready": True})
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            req = json.loads(line)
            result = handle(engine, req.get("method"), req.get("params") or {})
            send({"id": req.get("id"), "ok": True, "result": result})
        except ValidationError as exc:
            send({"id": req.get("id"), "ok": False,
                  "error": {"type": exc.kind, "message": str(exc), "field": exc.field}})
        except Exception as exc:  # noqa: BLE001 - report and keep serving
            traceback.print_exc()
            rid = req.get("id") if isinstance(locals().get("req"), dict) else None
            send({"id": rid, "ok": False, "error": {"type": "internal", "message": f"{type(exc).__name__}: {exc}"}})


if __name__ == "__main__":
    main()
