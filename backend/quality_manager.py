"""Read-only dataset checks for labels and image integrity."""
from __future__ import annotations

import hashlib
import math
import sqlite3
from collections import defaultdict
from pathlib import Path

from PIL import Image

from .project_manager import project_path, load_classes


def _db(project: str) -> sqlite3.Connection:
    con = sqlite3.connect(project_path(project) / "annotations.db")
    con.row_factory = sqlite3.Row
    return con


def _hash_file(path: Path, chunk: int = 1 << 20) -> str:
    digest = hashlib.sha1()
    with path.open("rb") as stream:
        while True:
            block = stream.read(chunk)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def _difference_hash(path: Path) -> int:
    """Return a compact 64-bit perceptual hash for near-duplicate matching."""
    resampling = getattr(Image, "Resampling", Image).LANCZOS
    with Image.open(path) as image:
        pixels = list(image.convert("L").resize((9, 8), resampling).getdata())
    value = 0
    for row in range(8):
        start = row * 9
        for col in range(8):
            value = (value << 1) | int(pixels[start + col] > pixels[start + col + 1])
    return value


def _issue(level: str, kind: str, filename: str | None = None, **details) -> dict:
    item = {"level": level, "kind": kind}
    if filename:
        item["filename"] = filename
    item.update(details)
    return item


def _box_iou(first: tuple[float, float, float, float],
             second: tuple[float, float, float, float]) -> float:
    ax1, ay1, ax2, ay2 = first
    bx1, by1, bx2, by2 = second
    iw = max(0.0, min(ax2, bx2) - max(ax1, bx1))
    ih = max(0.0, min(ay2, by2) - max(ay1, by1))
    intersection = iw * ih
    union = max(0.0, (ax2 - ax1) * (ay2 - ay1)) + max(
        0.0, (bx2 - bx1) * (by2 - by1)
    ) - intersection
    return intersection / union if union else 0.0


def _label_checks(filename: str, label_path: Path, class_ids: set[int], issues: list[dict],
                  boxes_by_image: dict[str, list[tuple[int, tuple[float, float, float, float]]]]) -> int:
    if not label_path.exists():
        issues.append(_issue("warning", "missing_label", filename))
        return 0
    try:
        text = label_path.read_text(encoding="utf-8", errors="strict")
    except (OSError, UnicodeError) as exc:
        issues.append(_issue("error", "invalid_yolo_coordinates", filename,
                             detail="Cannot read label file: " + str(exc)))
        return 0
    if not text.strip():
        issues.append(_issue("warning", "empty_label_file", filename))
        return 0

    valid_rows = 0
    for line_number, line in enumerate(text.splitlines(), 1):
        parts = line.split()
        if not parts:
            continue
        try:
            class_value = float(parts[0])
            if not math.isfinite(class_value) or not class_value.is_integer():
                raise ValueError("class ID must be an integer")
            class_id = int(class_value)
        except (ValueError, OverflowError):
            issues.append(_issue("error", "invalid_yolo_coordinates", filename,
                                 line=line_number, detail="Invalid class ID field"))
            continue
        if class_id not in class_ids:
            issues.append(_issue("error", "wrong_class_id", filename,
                                 line=line_number, class_id=class_id))

        try:
            values = [float(value) for value in parts[1:]]
            if not all(math.isfinite(value) for value in values):
                raise ValueError("coordinates must be finite numbers")
        except ValueError:
            issues.append(_issue("error", "invalid_yolo_coordinates", filename,
                                 line=line_number, detail="Coordinates must be finite numbers"))
            continue

        # Support standard YOLO boxes, this app's rotated-box records, and polygons.
        is_box = len(values) == 4
        is_rotated_box = len(values) == 5
        is_polygon = len(values) >= 6 and len(values) % 2 == 0
        if not (is_box or is_rotated_box or is_polygon):
            issues.append(_issue("error", "invalid_yolo_coordinates", filename,
                                 line=line_number, detail="Unexpected YOLO coordinate count"))
            continue
        valid_rows += 1

        coords = values[:-1] if is_rotated_box else values
        if any(value < 0 or value > 1 for value in coords):
            issues.append(_issue("error", "invalid_yolo_coordinates", filename,
                                 line=line_number, detail="Coordinates must be normalized from 0 to 1"))

        if is_box or is_rotated_box:
            cx, cy, width, height = values[:4]
            if width <= 0 or height <= 0:
                issues.append(_issue("error", "invalid_yolo_coordinates", filename,
                                     line=line_number, detail="Box width and height must be positive"))
                continue
            if is_rotated_box:
                angle = math.radians(values[4])
                half_w = (abs(math.cos(angle)) * width + abs(math.sin(angle)) * height) / 2
                half_h = (abs(math.sin(angle)) * width + abs(math.cos(angle)) * height) / 2
            else:
                half_w, half_h = width / 2, height / 2
            bounds = (cx - half_w, cy - half_h, cx + half_w, cy + half_h)
            if bounds[0] < 0 or bounds[1] < 0 or bounds[2] > 1 or bounds[3] > 1:
                issues.append(_issue("error", "box_outside_image", filename,
                                     line=line_number, bounds=[round(v, 6) for v in bounds]))
            if width * height < 1e-4:
                issues.append(_issue("warning", "extremely_small_box", filename,
                                     line=line_number, area=round(width * height, 8)))
            boxes_by_image[filename].append((line_number, bounds))
        elif is_polygon:
            xs, ys = values[0::2], values[1::2]
            if min(xs) < 0 or min(ys) < 0 or max(xs) > 1 or max(ys) > 1:
                issues.append(_issue("error", "box_outside_image", filename,
                                     line=line_number, detail="Polygon vertices extend outside the image"))
            area = max(xs) - min(xs)
            area *= max(ys) - min(ys)
            if area < 1e-4:
                issues.append(_issue("warning", "extremely_small_box", filename,
                                     line=line_number, area=round(area, 8)))
    return valid_rows


def run_checks(project: str) -> dict:
    p = project_path(project)
    class_ids = {int(item["id"]) for item in load_classes(project)}
    con = _db(project)
    rows = con.execute(
        "SELECT i.filename, i.width, i.height, COUNT(a.id) AS ann_count "
        "FROM images i LEFT JOIN annotations a ON a.image_id=i.id "
        "GROUP BY i.id ORDER BY i.filename"
    ).fetchall()
    con.close()

    issues: list[dict] = []
    boxes_by_image: dict[str, list[tuple[int, tuple[float, float, float, float]]]] = defaultdict(list)
    exact_hashes: dict[str, list[str]] = defaultdict(list)
    difference_hashes: dict[str, int] = {}
    label_counts: dict[str, int] = {}
    image_formats: dict[str, int] = defaultdict(int)

    for row in rows:
        filename = row["filename"]
        image_path = p / "images" / filename
        extension = image_path.suffix.lower() or "(no extension)"
        image_formats[extension] += 1
        label_path = p / "labels" / (Path(filename).stem + ".txt")
        label_counts[filename] = _label_checks(filename, label_path, class_ids,
                                                issues, boxes_by_image)
        if row["ann_count"] == 0:
            issues.append(_issue("warning", "image_without_annotations", filename))
        try:
            with Image.open(image_path) as image:
                image.verify()
            exact_hashes[_hash_file(image_path)].append(filename)
            difference_hashes[filename] = _difference_hash(image_path)
        except Exception as exc:
            issues.append(_issue("error", "corrupted_image", filename,
                                 detail=str(exc) or "Image cannot be decoded"))

    for filenames in exact_hashes.values():
        if len(filenames) > 1:
            issues.append(_issue("warning", "duplicate_image", files=filenames))

    # Candidate pairs share at least one untouched byte among eight hash bands.
    bands: dict[tuple[int, int], set[str]] = defaultdict(set)
    candidate_pairs: set[tuple[str, str]] = set()
    for filename, value in difference_hashes.items():
        for band in range(8):
            key = (band, (value >> (band * 8)) & 0xFF)
            for other in bands[key]:
                candidate_pairs.add(tuple(sorted((filename, other))))
            bands[key].add(filename)
    for first, second in candidate_pairs:
        if _hamming(difference_hashes[first], difference_hashes[second]) <= 5:
            first_path, second_path = p / "images" / first, p / "images" / second
            if _hash_file(first_path) != _hash_file(second_path):
                issues.append(_issue("warning", "near_duplicate_image",
                                     files=[first, second], distance=_hamming(
                                         difference_hashes[first], difference_hashes[second])))

    for filename, boxes in boxes_by_image.items():
        for index, (first_line, first_box) in enumerate(boxes):
            for second_line, second_box in boxes[index + 1:]:
                overlap = _box_iou(first_box, second_box)
                if overlap >= 0.8:
                    issues.append(_issue("warning", "overlapping_boxes", filename,
                                         lines=[first_line, second_line], iou=round(overlap, 4)))

    counts = [int(row["ann_count"]) for row in rows]
    if counts:
        ordered = sorted(counts)
        q1, q3 = ordered[(len(ordered) - 1) // 4], ordered[(3 * (len(ordered) - 1)) // 4]
        threshold = max(50, q3 + 1.5 * (q3 - q1))
        for row in rows:
            if row["ann_count"] > threshold:
                issues.append(_issue("warning", "high_annotation_count", row["filename"],
                                     count=int(row["ann_count"]), threshold=math.ceil(threshold)))

    summary = {
        "errors": sum(1 for item in issues if item["level"] == "error"),
        "warnings": sum(1 for item in issues if item["level"] == "warning"),
        "total": len(issues),
        "images_checked": len(rows),
        "labels_checked": len(label_counts),
        "image_formats": dict(sorted(image_formats.items())),
    }
    return {"summary": summary, "issues": issues}


def _hamming(first: int, second: int) -> int:
    return (first ^ second).bit_count()
