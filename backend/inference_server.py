"""A tiny local inference server (localhost:5001) that serves a loaded .pt.
Meant for your own use: no auth, binds to 127.0.0.1 only."""
from __future__ import annotations
import threading
from pathlib import Path

from flask import Flask, request, jsonify
import numpy as np

app = Flask(__name__)
_STATE = {"model": None, "path": None, "names": {}}


def load(path: str) -> dict:
    from ultralytics import YOLO
    m = YOLO(path)
    _STATE["model"] = m
    _STATE["path"] = path
    _STATE["names"] = m.names if hasattr(m, "names") else {}
    return {"path": path, "names": _STATE["names"]}


@app.get("/health")
def health():
    return jsonify({"loaded": _STATE["model"] is not None, "path": _STATE["path"],
                    "names": _STATE["names"]})


@app.post("/predict")
def predict():
    if _STATE["model"] is None:
        return jsonify({"error": "no model loaded"}), 503
    # accept either JSON path or uploaded file
    if "file" in request.files:
        import tempfile
        f = request.files["file"]
        tmp = Path(tempfile.gettempdir()) / f.filename
        f.save(tmp)
        src = str(tmp)
    else:
        src = (request.get_json(force=True) or {}).get("path")
        if not src:
            return jsonify({"error": "provide 'file' or {'path': ...}"}), 400

    conf = float(request.args.get("conf", 0.25))
    iou = float(request.args.get("iou", 0.45))
    res = _STATE["model"].predict(src, conf=conf, iou=iou, verbose=False)[0]
    h, w = res.orig_shape
    out = []
    if res.boxes is not None:
        for b in res.boxes:
            x1, y1, x2, y2 = b.xyxy[0].tolist()
            out.append({
                "class_id": int(b.cls.item()),
                "class_name": _STATE["names"].get(int(b.cls.item()), ""),
                "confidence": float(b.conf.item()),
                "xyxy": [x1, y1, x2, y2],
                "xywhn": [((x1+x2)/2)/w, ((y1+y2)/2)/h, (x2-x1)/w, (y2-y1)/h],
            })
    return jsonify({"image": src, "width": w, "height": h, "predictions": out})


def serve_in_thread(port: int = 5001):
    t = threading.Thread(
        target=lambda: app.run(host="127.0.0.1", port=port, threaded=True,
                               use_reloader=False),
        daemon=True,
    )
    t.start()
    return t