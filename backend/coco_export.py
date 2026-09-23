"""COCO JSON export (detection + polygon segmentation)."""
from __future__ import annotations
import json
import time
from pathlib import Path

from .project_manager import project_path, load_classes, BASE_DIR
from .annotation_manager import get_annotations

EXPORTS_DIR = BASE_DIR / "exports"


def export_coco(project: str, annotated_only: bool = False) -> str:
    p = project_path(project)
    classes = load_classes(project)
    images = sorted([f for f in (p / "images").iterdir() if f.is_file()])
    annotations_by_file = {f.name: get_annotations(project, f.name) for f in images}
    if annotated_only:
        images = [f for f in images if annotations_by_file[f.name]]
    if not images:
        raise ValueError("No images match the selected export options")

    coco = {
        "info": {"description": project, "version": "1.0",
                 "date_created": time.strftime("%Y-%m-%dT%H:%M:%S")},
        "licenses": [],
        "images": [],
        "annotations": [],
        "categories": [{"id": c["id"] + 1, "name": c["name"],
                        "supercategory": "object"} for c in classes],
    }
    ann_id = 1
    for img_id, f in enumerate(images, 1):
        from PIL import Image
        with Image.open(f) as im:
            w, h = im.size
        coco["images"].append({
            "id": img_id, "file_name": f.name, "width": w, "height": h,
        })
        for a in annotations_by_file[f.name]:
            cid = a["class_id"] + 1
            if a["type"] == "box":
                x, y, bw, bh = a["x"]*w, a["y"]*h, a["w"]*w, a["h"]*h
                coco["annotations"].append({
                    "id": ann_id, "image_id": img_id, "category_id": cid,
                    "bbox": [x, y, bw, bh], "area": bw*bh, "iscrowd": 0,
                })
                ann_id += 1
            elif a["type"] == "polygon":
                pts = [[px*w, py*h] for px, py in a["points"]]
                flat = [v for xy in pts for v in xy]
                # polygon area (shoelace)
                area = 0.0
                n = len(pts)
                for i in range(n):
                    x1, y1 = pts[i]; x2, y2 = pts[(i+1) % n]
                    area += x1*y2 - x2*y1
                area = abs(area) / 2
                coco["annotations"].append({
                    "id": ann_id, "image_id": img_id, "category_id": cid,
                    "segmentation": [flat], "area": area, "iscrowd": 0,
                    "bbox": _bbox_from_pts(pts),
                })
                ann_id += 1
            elif a["type"] == "obb":
                import math
                cx, cy = a["cx"] * w, a["cy"] * h
                bw, bh = a["w"] * w, a["h"] * h
                angle = math.radians(a.get("rotation", 0))
                xs = [cx + sx * bw / 2 * math.cos(angle) - sy * bh / 2 * math.sin(angle)
                      for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
                ys = [cy + sx * bw / 2 * math.sin(angle) + sy * bh / 2 * math.cos(angle)
                      for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
                coco["annotations"].append({
                    "id": ann_id, "image_id": img_id, "category_id": cid,
                    "bbox": [min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)],
                    "area": bw * bh, "iscrowd": 0,
                })
                ann_id += 1

    EXPORTS_DIR.mkdir(exist_ok=True)
    out = EXPORTS_DIR / f"{p.name}_coco.json"
    out.write_text(json.dumps(coco, indent=2), encoding="utf-8")
    return str(out)


def _bbox_from_pts(pts):
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    return [min(xs), min(ys), max(xs)-min(xs), max(ys)-min(ys)]
