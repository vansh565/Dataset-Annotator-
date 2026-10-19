"""Local evaluation of a trained .pt against a version's val split."""
from __future__ import annotations
import json
import time
from pathlib import Path

from .project_manager import BASE_DIR
from . import version_manager as vm

RUNS_DIR = BASE_DIR / "runs"


def evaluate(project: str, version_id: int, model_path: str,
             split: str = "val", imgsz: int = 640,
             conf: float = 0.001, iou: float = 0.6) -> dict:
    from ultralytics import YOLO
    vdir = vm.versions_dir(project) / f"v{version_id}"
    if not vdir.exists():
        raise FileNotFoundError(f"v{version_id}")

    # Build a temp dataset with the requested split
    from .training_manager import _prepare_dataset_yaml
    yaml_path = _prepare_dataset_yaml(vdir, split=True)
    model = YOLO(model_path)
    metrics = model.val(data=str(yaml_path), imgsz=imgsz, conf=conf, iou=iou,
                        split=split, verbose=False)

    report = {
        "project": project,
        "version": version_id,
        "model": model_path,
        "split": split,
        "created_at": time.time(),
        "mAP50": float(getattr(metrics.box, "map50", 0.0)),
        "mAP50_95": float(getattr(metrics.box, "map", 0.0)),
        "precision": float(getattr(metrics.box, "mp", 0.0)),
        "recall": float(getattr(metrics.box, "mr", 0.0)),
        "per_class": [],
    }
    names = metrics.names if hasattr(metrics, "names") else {}
    try:
        ap_class = metrics.box.ap_class_index.tolist()
        p = metrics.box.p.tolist()
        r = metrics.box.r.tolist()
        ap50 = metrics.box.ap50.tolist()
        ap = metrics.box.ap.tolist()
        for i, cid in enumerate(ap_class):
            report["per_class"].append({
                "class_id": int(cid),
                "name": names.get(int(cid), str(cid)),
                "precision": p[i], "recall": r[i],
                "mAP50": ap50[i], "mAP50_95": ap[i],
            })
    except Exception:
        pass

    out = RUNS_DIR / f"eval_{project}_v{version_id}_{int(time.time())}.json"
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    report["report_path"] = str(out)
    return report
