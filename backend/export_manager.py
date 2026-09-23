"""YOLO detection export (v1) + train/val/test split.
Windows-safe: retries rmtree on PermissionError, uses timestamped output
folders so a locked previous export never blocks a new one."""
from __future__ import annotations
import json
import random
import shutil
import time
import zipfile
from pathlib import Path

import yaml

from .project_manager import project_path, load_classes, BASE_DIR
from .annotation_manager import get_annotations
from . import dataset_manager as dm

EXPORTS_DIR = BASE_DIR / "exports"
EXPORTS_DIR.mkdir(parents=True, exist_ok=True)


# ------------------------------------------------------------------ helpers
def _rmtree_safe(p: Path, attempts: int = 6, delay: float = 0.4) -> None:
    """Windows-safe rmtree. Retries on WinError 32 (file locked by Explorer,
    Defender, Search Indexer, or a leftover preview handle)."""
    if not p.exists():
        return
    last_err: Exception | None = None
    for i in range(attempts):
        try:
            shutil.rmtree(p)
            return
        except PermissionError as e:
            last_err = e
            # try to clear read-only attribute, then wait and retry
            for f in p.rglob("*"):
                try:
                    f.chmod(0o666)
                except Exception:
                    pass
            time.sleep(delay)
        except FileNotFoundError:
            return
    # last resort: rename and let the caller write to a fresh folder
    try:
        alt = p.with_name(p.name + f"_locked_{int(time.time())}")
        p.rename(alt)
        print(f"[export] couldn't delete {p}, renamed to {alt}")
        return
    except Exception:
        raise last_err if last_err else RuntimeError(f"cannot remove {p}")


def _unique_out(base: Path) -> Path:
    """Return base if free, else base with a timestamp suffix. Never deletes."""
    if not base.exists():
        return base
    # try to remove the old one; if that fails, pick a new name
    try:
        _rmtree_safe(base)
        if not base.exists():
            return base
    except Exception:
        pass
    return base.with_name(f"{base.name}_{time.strftime('%Y%m%d_%H%M%S')}")


def _write_yaml(out_dir: Path, classes: list[dict], splits: bool) -> None:
    data = {
        "path": str(out_dir.resolve()),
        "train": "images/train" if splits else "images",
        "val": "images/val" if splits else "images",
    }
    if splits:
        data["test"] = "images/test"
    data["names"] = {c["id"]: c["name"] for c in classes}
    (out_dir / "data.yaml").write_text(
        yaml.safe_dump(data, sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )


def _zip_dir(src: Path, zip_path: Path) -> Path:
    """Zip src into zip_path. If zip_path is locked, fall back to a timestamped name."""
    try:
        if zip_path.exists():
            zip_path.unlink()
    except PermissionError:
        zip_path = zip_path.with_name(
            f"{zip_path.stem}_{int(time.time())}{zip_path.suffix}"
        )
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for file in src.rglob("*"):
            if file.is_file():
                zf.write(file, file.relative_to(src))
    return zip_path


# ------------------------------------------------------------------ public
def export_yolo(project: str, split: bool = False,
                ratios: tuple[float, float, float] = (0.7, 0.2, 0.1),
                seed: int = 42, annotated_only: bool = False) -> str:
    p = project_path(project)
    classes = load_classes(project)

    image_rows = {row["filename"]: row for row in dm.list_images(project)}
    images = sorted([f for f in (p / "images").iterdir()
                     if f.is_file() and (not annotated_only or
                                         image_rows.get(f.name, {}).get("ann_count", 0) > 0)])
    if not images:
        raise ValueError("No images match the selected export options")

    # never delete in place; get a fresh folder
    base = EXPORTS_DIR / f"{p.name}_yolo"
    out = _unique_out(base)
    out.mkdir(parents=True, exist_ok=True)

    def _copy_pair(img: Path, sub: str | None = None):
        img_dir = out / "images" / (sub or "")
        lbl_dir = out / "labels" / (sub or "")
        img_dir.mkdir(parents=True, exist_ok=True)
        lbl_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(img, img_dir / img.name)
        lbl = p / "labels" / (img.stem + ".txt")
        if lbl.exists():
            shutil.copy2(lbl, lbl_dir / lbl.name)

    if split:
        split_keys = ("train", "val", "test")
        ratio_total = sum(max(0, float(value)) for value in ratios) or 1.0
        normalized = [max(0, float(value)) / ratio_total for value in ratios]
        targets = {"train": int(len(images) * normalized[0]),
                   "val": int(len(images) * normalized[1])}
        targets["test"] = len(images) - targets["train"] - targets["val"]
        assignments = {img.name: image_rows.get(img.name, {}).get("dataset_split")
                       for img in images}
        assignments = {name: value for name, value in assignments.items()
                       if value in split_keys}
        counts = {key: sum(value == key for value in assignments.values()) for key in split_keys}
        automatic = [img for img in images if img.name not in assignments]
        random.Random(seed).shuffle(automatic)
        for img in automatic:
            chosen = max(split_keys, key=lambda key: (targets[key] - counts[key], -split_keys.index(key)))
            assignments[img.name] = chosen
            counts[chosen] += 1
        for img in images:
            _copy_pair(img, assignments[img.name])
    else:
        for img in images:
            _copy_pair(img)

    _write_yaml(out, classes, split)

    zip_path = _zip_dir(out, EXPORTS_DIR / f"{out.name}.zip")
    return str(zip_path)


def export_csv(project: str, annotated_only: bool = True) -> str:
    import csv
    p = project_path(project)
    classes = {c["id"]: c["name"] for c in load_classes(project)}
    out = EXPORTS_DIR / f"{p.name}_annotations.csv"
    with out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["filename", "type", "class_id", "class_name",
                    "x", "y", "w", "h", "confidence", "rotation_or_points"])
        for img in sorted((p / "images").iterdir()):
            if not img.is_file():
                continue
            annotations = get_annotations(project, img.name)
            if annotated_only and not annotations:
                continue
            for a in annotations:
                if a["type"] == "box":
                    w.writerow([img.name, "box", a["class_id"],
                                classes.get(a["class_id"], ""),
                                round(a["x"], 6), round(a["y"], 6),
                                round(a["w"], 6), round(a["h"], 6),
                                a.get("confidence", 1.0), ""])
                elif a["type"] == "polygon":
                    w.writerow([img.name, "polygon", a["class_id"],
                                classes.get(a["class_id"], ""),
                                "", "", "", "",
                                a.get("confidence", 1.0), json.dumps(a["points"])])
                elif a["type"] == "obb":
                    w.writerow([img.name, "obb", a["class_id"],
                                classes.get(a["class_id"], ""),
                                round(a["cx"], 6), round(a["cy"], 6),
                                round(a["w"], 6), round(a["h"], 6),
                                a.get("confidence", 1.0), round(a.get("rotation", 0), 6)])
    return str(out)
