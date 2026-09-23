"""Local YOLO training launcher (Ultralytics). Writes results into models/<run>/."""
from __future__ import annotations
import json
import os
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from .project_manager import BASE_DIR

MODELS_DIR = BASE_DIR / "models"
MODELS_DIR.mkdir(exist_ok=True)

RUNS_DIR = BASE_DIR / "runs"
RUNS_DIR.mkdir(exist_ok=True)

# in-memory registry of running jobs
_JOBS: dict[str, dict[str, Any]] = {}


def _prepare_dataset_yaml(version_dir: Path, split: bool,
                          ratios=(0.7, 0.2, 0.1), seed=42) -> Path:
    """Reuse version_manager's YOLO exporter to build a dataset dir + yaml."""
    from . import version_manager as vm
    import shutil, yaml, random

    out = RUNS_DIR / f"_dataset_{version_dir.name}_{int(time.time())}"
    out.mkdir(parents=True, exist_ok=True)

    classes = json.loads((version_dir / "classes.json").read_text(encoding="utf-8"))
    images = sorted([f for f in (version_dir / "images").iterdir() if f.is_file()])

    def _cp(img, sub):
        (out / "images" / sub).mkdir(parents=True, exist_ok=True)
        (out / "labels" / sub).mkdir(parents=True, exist_ok=True)
        shutil.copy2(img, out / "images" / sub / img.name)
        lbl = version_dir / "labels" / (img.stem + ".txt")
        if lbl.exists():
            shutil.copy2(lbl, out / "labels" / sub / lbl.name)

    if split:
        rng = random.Random(seed); rng.shuffle(images)
        n = len(images); n_tr = int(n * ratios[0]); n_va = int(n * ratios[1])
        for img in images[:n_tr]: _cp(img, "train")
        for img in images[n_tr:n_tr+n_va]: _cp(img, "val")
        for img in images[n_tr+n_tr+n_va:]: _cp(img, "test")
    else:
        for img in images: _cp(img, "")

    data = {
        "path": str(out.resolve()),
        "train": "images/train" if split else "images",
        "val":   "images/val"   if split else "images",
    }
    if split: data["test"] = "images/test"
    data["names"] = {c["id"]: c["name"] for c in classes}
    yml = out / "data.yaml"
    yml.write_text(yaml.safe_dump(data, sort_keys=False, allow_unicode=True),
                   encoding="utf-8")
    return yml


def start_training(project: str, version_id: int, base_model: str = "yolo11n.pt",
                   epochs: int = 100, imgsz: int = 640, batch: int = 16,
                   device: str | None = None, split: bool = True) -> dict:
    from . import version_manager as vm
    vdir = vm.versions_dir(project) / f"v{version_id}"
    if not vdir.exists():
        raise FileNotFoundError(f"v{version_id}")

    yaml_path = _prepare_dataset_yaml(vdir, split)
    job_id = uuid.uuid4().hex[:12]
    run_dir = RUNS_DIR / f"{project}_v{version_id}_{job_id}"
    run_dir.mkdir(parents=True, exist_ok=True)
    log_path = run_dir / "train.log"

    cmd = [
        sys.executable, "-c",
        (
            "from ultralytics import YOLO; import sys; "
            f"m = YOLO(r'{base_model}'); "
            f"m.train(data=r'{yaml_path}', epochs={epochs}, imgsz={imgsz}, "
            f"batch={batch}, project=r'{run_dir}', name='train', exist_ok=True, "
            f"device='{device or ''}'); "
            f"print('BEST', m.trainer.best)"
        ),
    ]

    def _run():
        _JOBS[job_id]["status"] = "running"
        _JOBS[job_id]["started"] = time.time()
        with open(log_path, "w", encoding="utf-8") as fh:
            proc = subprocess.Popen(
                cmd, stdout=fh, stderr=subprocess.STDOUT,
                cwd=str(BASE_DIR), env={**os.environ, "PYTHONUNBUFFERED": "1"},
            )
            _JOBS[job_id]["pid"] = proc.pid
            rc = proc.wait()
        _JOBS[job_id]["status"] = "done" if rc == 0 else "failed"
        _JOBS[job_id]["returncode"] = rc
        _JOBS[job_id]["finished"] = time.time()
        # copy best.pt into models/
        best = run_dir / "train" / "weights" / "best.pt"
        if best.exists():
            dest = MODELS_DIR / f"{project}_v{version_id}_{job_id}.pt"
            try: __import__("shutil").copy2(best, dest)
            except Exception: pass
            _JOBS[job_id]["best"] = str(dest)

    _JOBS[job_id] = {
        "id": job_id, "project": project, "version": version_id,
        "status": "queued", "run_dir": str(run_dir), "log": str(log_path),
    }
    threading.Thread(target=_run, daemon=True).start()
    return _JOBS[job_id]


def job_status(job_id: str) -> dict:
    job = _JOBS.get(job_id)
    if not job:
        raise KeyError(job_id)
    # last 40 lines of log
    try:
        lines = Path(job["log"]).read_text(encoding="utf-8", errors="ignore").splitlines()
        job["tail"] = lines[-40:]
    except Exception:
        job["tail"] = []
    return job


def list_jobs() -> list[dict]:
    return sorted(_JOBS.values(), key=lambda j: j.get("started", 0), reverse=True)