"""Local YOLO training launcher (Ultralytics). Writes results into models/<run>/."""
from __future__ import annotations
import json
import os
import re
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
_JOB_PROCESSES: dict[str, subprocess.Popen] = {}
_JOB_LOCK = threading.RLock()


def _restore_completed_jobs() -> None:
    """Rebuild completed job cards from checkpoints after an app restart."""
    pattern = re.compile(r"^(?P<project>.+)_v(?P<version>\d+)_(?P<job>[a-f0-9]{12})$")
    for model_path in MODELS_DIR.glob("*.pt"):
        match = pattern.match(model_path.stem)
        if not match:
            continue
        project = match.group("project")
        version = int(match.group("version"))
        job_id = match.group("job")
        run_dir = RUNS_DIR / model_path.stem
        log_path = run_dir / "train.log"
        timestamp = model_path.stat().st_mtime
        status = "stopped" if (run_dir / "stopped").exists() else "done"
        _JOBS[job_id] = {
            "id": job_id, "project": project, "version": version,
            "status": status, "run_dir": str(run_dir),
            "log": str(log_path), "best": str(model_path),
            "started": timestamp, "finished": timestamp,
        }


_restore_completed_jobs()


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
        # Reuse the exact per-image assignments frozen into the version. Older
        # snapshots without that map receive a deterministic ratio-based split.
        meta_path = version_dir / "version.json"
        try:
            version_meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            version_meta = {}
        version_ratios = version_meta.get("split", {})
        ratios = (version_ratios.get("train", ratios[0]),
                  version_ratios.get("val", ratios[1]),
                  version_ratios.get("test", ratios[2]))
        saved_splits = version_meta.get("image_splits", {})
        valid = {"train", "val", "test"}
        assignments = {
            img.name: saved_splits[img.name]
            for img in images
            if saved_splits.get(img.name) in valid
        }
        missing = [img for img in images if img.name not in assignments]
        if missing:
            rng = random.Random(seed)
            rng.shuffle(missing)
            ratio_values = [max(0.0, float(value)) for value in ratios]
            ratio_total = sum(ratio_values) or 1.0
            ratio_values = [value / ratio_total for value in ratio_values]
            targets = {
                "train": int(len(images) * ratio_values[0]),
                "val": int(len(images) * ratio_values[1]),
            }
            targets["test"] = len(images) - targets["train"] - targets["val"]
            counts = {key: sum(1 for value in assignments.values() if value == key)
                      for key in ("train", "val", "test")}
            for img in missing:
                target = max(("train", "val", "test"),
                             key=lambda key: (targets[key] - counts[key],
                                              -("train", "val", "test").index(key)))
                assignments[img.name] = target
                counts[target] += 1
        for img in images:
            _cp(img, assignments[img.name])
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
        with _JOB_LOCK:
            if _JOBS[job_id].get("stop_requested"):
                _JOBS[job_id]["status"] = "stopped"
                _JOBS[job_id]["finished"] = time.time()
                return
            _JOBS[job_id]["status"] = "running"
            _JOBS[job_id]["started"] = time.time()
        with open(log_path, "w", encoding="utf-8") as fh:
            with _JOB_LOCK:
                proc = subprocess.Popen(
                    cmd, stdout=fh, stderr=subprocess.STDOUT,
                    cwd=str(BASE_DIR), env={**os.environ, "PYTHONUNBUFFERED": "1"},
                    creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
                )
                _JOB_PROCESSES[job_id] = proc
                _JOBS[job_id]["pid"] = proc.pid
                stop_requested = _JOBS[job_id].get("stop_requested", False)
            if stop_requested:
                _terminate_process_tree(proc)
            rc = proc.wait()
        # copy best.pt into models/
        best = run_dir / "train" / "weights" / "best.pt"
        if best.exists():
            dest = MODELS_DIR / f"{project}_v{version_id}_{job_id}.pt"
            try: __import__("shutil").copy2(best, dest)
            except Exception: pass
            if dest.exists():
                with _JOB_LOCK:
                    _JOBS[job_id]["best"] = str(dest)
        with _JOB_LOCK:
            stopped = _JOBS[job_id].get("stop_requested", False)
            _JOBS[job_id]["status"] = "stopped" if stopped and rc != 0 else ("done" if rc == 0 else "failed")
            _JOBS[job_id]["returncode"] = rc
            _JOBS[job_id]["finished"] = time.time()
            _JOB_PROCESSES.pop(job_id, None)
        if stopped and rc != 0:
            (run_dir / "stopped").touch()

    _JOBS[job_id] = {
        "id": job_id, "project": project, "version": version_id,
        "status": "queued", "run_dir": str(run_dir), "log": str(log_path),
    }
    threading.Thread(target=_run, daemon=True).start()
    return _JOBS[job_id]


def job_status(job_id: str) -> dict:
    with _JOB_LOCK:
        job = _JOBS.get(job_id)
        if not job:
            raise KeyError(job_id)
        job = dict(job)
    # last 40 lines of log
    try:
        lines = Path(job["log"]).read_text(encoding="utf-8", errors="ignore").splitlines()
        job["tail"] = lines[-40:]
    except Exception:
        job["tail"] = []
    return job


def list_jobs() -> list[dict]:
    with _JOB_LOCK:
        jobs = [dict(job) for job in _JOBS.values()]
    return sorted(jobs, key=lambda j: j.get("started", 0), reverse=True)


def _terminate_process_tree(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    if os.name == "nt":
        try:
            # Start tree cleanup without waiting, then terminate the actual
            # training process directly so the epoch loop stops immediately.
            subprocess.Popen(
                ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except OSError:
            pass
    try:
        proc.terminate()
    except OSError:
        pass


def stop_training(job_id: str) -> dict:
    with _JOB_LOCK:
        job = _JOBS.get(job_id)
        if not job:
            raise KeyError(job_id)
        if job.get("status") in {"done", "failed", "stopped"}:
            raise ValueError("training job is already finished")
        if job.get("status") == "stopping":
            return dict(job)
        job["stop_requested"] = True
        job["status"] = "stopping"
        proc = _JOB_PROCESSES.get(job_id)
        if proc is None:
            return dict(job)
    _terminate_process_tree(proc)
    return job_status(job_id)


def model_download_path(job_id: str) -> Path:
    with _JOB_LOCK:
        job = _JOBS.get(job_id)
        if not job:
            raise KeyError(job_id)
        value = job.get("best")
    if not value:
        raise FileNotFoundError("This training job has no saved best model")
    path = Path(value).resolve()
    if path.parent != MODELS_DIR.resolve() or not path.is_file():
        raise FileNotFoundError("This training job has no saved best model")
    return path


def forget_model_path(model_path: Path) -> None:
    target = model_path.resolve()
    with _JOB_LOCK:
        for job in _JOBS.values():
            value = job.get("best")
            if value and Path(value).resolve() == target:
                job.pop("best", None)
