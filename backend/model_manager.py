"""Local YOLO model loading + inference. Optional — works without torch installed."""
from __future__ import annotations
from pathlib import Path
import re
from threading import RLock
from typing import Any

from .project_manager import BASE_DIR, project_path, load_classes

MODELS_DIR = BASE_DIR / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)

_MODEL_CACHE: dict[str, Any] = {}
_MODEL_LOCK = RLock()


def device_info() -> dict:
    try:
        import torch
        if torch.cuda.is_available():
            return {"device": "cuda", "name": torch.cuda.get_device_name(0)}
        return {"device": "cpu", "name": "CPU"}
    except Exception:
        return {"device": "cpu", "name": "CPU (torch not installed)"}


_TRAINED_MODEL_RE = re.compile(r"^(?P<project>.+)_v\d+_[a-f0-9]{12}$", re.IGNORECASE)


def _trained_project(filename: str) -> str | None:
    match = _TRAINED_MODEL_RE.match(Path(filename).stem)
    return match.group("project") if match else None


def list_models(project: str | None = None) -> list[dict]:
    models = [
        {"name": f.name, "path": str(f), "size": f.stat().st_size}
        for f in sorted(MODELS_DIR.glob("*.pt"))
        if project is None or _trained_project(f.name) in (None, project)
    ]
    if not any(m["name"].lower() == "sam2.1_l.pt" for m in models):
        models.append({
            "name": "sam2.1_l.pt",
            "path": str(MODELS_DIR / "sam2.1_l.pt"),
            "size": 0,
            "kind": "sam",
            "available": False,
            "description": "SAM 2.1 Large; downloads on first use",
        })
    return models


def delete_project_model(project: str, name: str) -> Path:
    target = (MODELS_DIR / name).resolve()
    if target.parent != MODELS_DIR.resolve() or target.suffix.lower() != ".pt":
        raise ValueError("Only .pt files in the local models folder can be deleted")
    owner = _trained_project(target.name)
    if owner is not None and owner != project:
        raise ValueError("That model belongs to another project")
    return delete_model(str(target))


def load_model(path: str):
    from ultralytics import SAM, YOLO  # lazy import
    is_sam = Path(path).name.lower().startswith("sam2")
    key = ("sam:" if is_sam else "yolo:") + str(Path(path).resolve())
    # Ultralytics initializes and mutates its predictor lazily on predict().
    # Serialize cache access; callers hold the same reentrant lock through
    # inference so two requests cannot initialize/use one predictor at once.
    with _MODEL_LOCK:
        if key not in _MODEL_CACHE:
            _MODEL_CACHE[key] = SAM(path) if is_sam else YOLO(path)
        return _MODEL_CACHE[key]


def warm_model(path: str) -> dict:
    """Load a model into the process cache before the first user prompt."""
    load_model(path)
    return {"path": path, "ready": True}


def delete_model(path: str) -> Path:
    """Delete one local checkpoint without allowing paths outside models/."""
    target = Path(path).resolve()
    if target.parent != MODELS_DIR.resolve() or target.suffix.lower() != ".pt":
        raise ValueError("Only .pt files in the local models folder can be deleted")
    with _MODEL_LOCK:
        if not target.is_file():
            raise FileNotFoundError(target.name)
        target.unlink()
        for key in list(_MODEL_CACHE):
            if key.partition(":")[2] == str(target):
                _MODEL_CACHE.pop(key, None)
    return target


def autolabel_image(project: str, filename: str, model_path: str,
                    conf: float = 0.25, iou: float = 0.45,
                    allowed_class_ids: list[int] | None = None,
                    device: str | None = None,
                    segmentation: bool = False,
                    sam_class_id: int = 0) -> list[dict]:
    """Runs YOLO on one image and returns normalized box or polygon annotations."""
    from .dataset_manager import get_image_path
    img_path = get_image_path(project, filename)
    with _MODEL_LOCK:
        model = load_model(model_path)
        if device:
            try:
                model.to(device)
            except Exception:
                pass
        results = model.predict(str(img_path), conf=conf, iou=iou, verbose=False)
    if not results:
        return []
    r = results[0]
    h, w = r.orig_shape
    out = []
    is_sam = Path(model_path).name.lower().startswith("sam2")
    if is_sam and r.masks is not None:
        for points in r.masks.xy:
            if len(points) < 3:
                continue
            out.append({
                "type": "polygon",
                "class_id": sam_class_id,
                "points": [[float(x) / w, float(y) / h] for x, y in points],
                "confidence": 1.0,
                "_model_name": "SAM 2.1 Large",
            })
        return out
    names = r.names  # dict id->name
    if r.boxes is None:
        return out
    if segmentation and r.masks is not None:
        polygons = r.masks.xy
        for b, points in zip(r.boxes, polygons):
            if len(points) < 3:
                continue
            cid = int(b.cls.item())
            out.append({
                "type": "polygon",
                "class_id": cid,
                "points": [[float(x) / w, float(y) / h] for x, y in points],
                "confidence": float(b.conf.item()),
                "_model_name": names.get(cid, str(cid)),
            })
        if out:
            if allowed_class_ids:
                out = [a for a in out if a["class_id"] in allowed_class_ids]
            return out
    for b in r.boxes:
        cid = int(b.cls.item())
        xyxy = b.xyxy[0].tolist()
        x1, y1, x2, y2 = xyxy
        nx = x1 / w
        ny = y1 / h
        nw = (x2 - x1) / w
        nh = (y2 - y1) / h
        out.append({
            "type": "box",
            "class_id": cid,
            "x": nx, "y": ny, "w": nw, "h": nh,
            "confidence": float(b.conf.item()),
            "_model_name": names.get(cid, str(cid)),
        })
    if allowed_class_ids:
        out = [a for a in out if a["class_id"] in allowed_class_ids]
    return out


def smart_select_image(project: str, filename: str, model_path: str,
                       x: float | None = None, y: float | None = None,
                       class_id: int = 0, device: str | None = None,
                       box: list[float] | None = None) -> list[dict]:
    """Segment an object from a normalized point or bounding-box prompt."""
    from PIL import Image
    from .dataset_manager import get_image_path

    img_path = get_image_path(project, filename)
    with Image.open(img_path) as image:
        width, height = image.size
    prompt = {}
    if box is not None:
        if len(box) != 4:
            raise ValueError("box must contain x, y, width, and height")
        bx, by, bw, bh = [float(value) for value in box]
        bx = max(0.0, min(1.0, bx))
        by = max(0.0, min(1.0, by))
        bw = max(0.0, min(1.0 - bx, bw))
        bh = max(0.0, min(1.0 - by, bh))
        if bw <= 0.0 or bh <= 0.0:
            raise ValueError("box must overlap the image")
        prompt["bboxes"] = [[bx * width, by * height,
                              (bx + bw) * width, (by + bh) * height]]
    elif x is not None and y is not None:
        prompt["points"] = [[float(x) * width, float(y) * height]]
        prompt["labels"] = [1]
    else:
        raise ValueError("smart selection requires a point or box")
    with _MODEL_LOCK:
        model = load_model(model_path)
        if device:
            try:
                model.to(device)
            except Exception:
                pass
        results = model.predict(str(img_path), verbose=False, **prompt)
    if not results or results[0].masks is None:
        return []
    out = []
    for points in results[0].masks.xy:
        if len(points) < 3:
            continue
        out.append({
            "type": "polygon",
            "class_id": class_id,
            "points": [[float(px) / width, float(py) / height]
                       for px, py in points],
            "confidence": 1.0,
            "_model_name": "SAM 2.1 Large",
        })
    return out[:1]


def autolabel_dataset(project: str, model_path: str, conf: float = 0.25,
                      iou: float = 0.45, overwrite: bool = False,
                      progress_cb=None) -> dict:
    """Batch auto-annotation. Skips already-annotated images unless overwrite."""
    from .dataset_manager import list_images
    from .annotation_manager import get_annotations, save_annotations
    imgs = list_images(project)
    done = skipped = 0
    total = len(imgs)
    for i, img in enumerate(imgs):
        fn = img["filename"]
        if not overwrite and img["ann_count"] > 0:
            skipped += 1
        else:
            anns = autolabel_image(project, fn, model_path, conf, iou)
            save_annotations(project, fn, anns)
            done += 1
        if progress_cb:
            progress_cb(i + 1, total)
    return {"processed": done, "skipped": skipped, "total": total}
