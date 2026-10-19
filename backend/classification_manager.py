"""Manual image-classification labels and export for a project."""
from __future__ import annotations

import json
import os
import re
import tempfile
import zipfile
from collections import defaultdict
from pathlib import Path

from .project_manager import project_path
from . import dataset_manager as dm

SPLITS = ("train", "val", "test")
DEFAULT_BRANDS = ["Hyundai", "Suzuki", "Tata", "Mahindra", "Kia"]
_BRAND_RE = re.compile(r"^[\w][\w .-]{0,63}$", re.UNICODE)
_WINDOWS_RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)),
                     *(f"LPT{i}" for i in range(1, 10))}


def _valid_folder_name(name: str) -> bool:
    return (bool(_BRAND_RE.fullmatch(name)) and name not in (".", "..") and
            not name.endswith(".") and name.upper() not in _WINDOWS_RESERVED)


def _config_path(project: str) -> Path:
    return project_path(project) / "classification.json"


def get_config(project: str) -> dict:
    path = _config_path(project)
    if not path.exists():
        return {"enabled": False, "brands": DEFAULT_BRANDS.copy()}
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        config = {}
    return {"enabled": bool(config.get("enabled", False)),
            "brands": _clean_brands(config.get("brands", DEFAULT_BRANDS))}


def _clean_brands(brands) -> list[str]:
    result, seen = [], set()
    for value in brands if isinstance(brands, list) else []:
        name = str(value).strip()
        if not _valid_folder_name(name):
            raise ValueError(f"Invalid brand folder name: {name!r}")
        if name.casefold() not in seen:
            seen.add(name.casefold())
            result.append(name)
    if not result:
        raise ValueError("Add at least one brand folder")
    return result


def save_config(project: str, enabled: bool, brands: list[str]) -> dict:
    clean = _clean_brands(brands)
    images = dm.list_images(project)
    removed = {row.get("classification_brand") for row in images
               if row.get("classification_brand") and row["classification_brand"] not in clean}
    if removed:
        raise ValueError("Cannot remove assigned brand folders: " + ", ".join(sorted(removed)))
    value = {"enabled": bool(enabled), "brands": clean}
    _config_path(project).write_text(json.dumps(value, indent=2), encoding="utf-8")
    return value


def set_image_brand(project: str, filename: str, brand: str | None) -> None:
    config = get_config(project)
    if not config["enabled"]:
        raise ValueError("Enable Image Classification Format before assigning brands")
    if brand is not None and brand not in config["brands"]:
        raise ValueError("Choose a brand folder from the configured list")
    dm.set_classification_brand(project, filename, brand)


def _validate_dataset_name(dataset_name: str) -> str:
    if not isinstance(dataset_name, str) or not _valid_folder_name(dataset_name.strip()):
        raise ValueError("Dataset name must be a simple folder name")
    return dataset_name.strip()


def _write_classification_zip(config: dict, dataset_name: str,
                              groups: dict, skipped_no_brand: int,
                              skipped_no_split: int, missing_files: int) -> dict:
    dataset_name = _validate_dataset_name(dataset_name)
    counts = {split: {brand: 0 for brand in config["brands"]} for split in SPLITS}
    total = sum(len(items) for items in groups.values())
    if total == 0:
        raise ValueError("No exportable images. Assign each image a brand and train/validation/test split first.")

    archive_fd, archive_name = tempfile.mkstemp(prefix=f"{dataset_name}_", suffix=".zip")
    os.close(archive_fd)
    archive_path = Path(archive_name)
    try:
        with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as archive:
            for split in SPLITS:
                for brand in config["brands"]:
                    archive.writestr(f"{dataset_name}/{split}/{brand}/", "")
                    used_names: set[str] = set()
                    for item in groups[(split, brand)]:
                        original = item["filename"]
                        target_name = original
                        stem, suffix = Path(original).stem, Path(original).suffix
                        index = 1
                        while target_name.casefold() in used_names:
                            target_name = f"{stem}_{index}{suffix}"
                            index += 1
                        used_names.add(target_name.casefold())
                        archive.write(item["source"], f"{dataset_name}/{split}/{brand}/{target_name}")
                        counts[split][brand] += 1
    except Exception:
        archive_path.unlink(missing_ok=True)
        raise

    warnings = []
    if total < 10:
        warnings.append(f"Only {total} image(s) exported; the dataset may be insufficient for reliable training/evaluation.")
    for brand in config["brands"]:
        brand_total = sum(counts[split][brand] for split in SPLITS)
        if not brand_total:
            warnings.append(f"{brand}: no images exported; its folders are empty.")
        elif brand_total < 3:
            warnings.append(f"{brand}: only {brand_total} image(s); this may be insufficient for training/evaluation.")
    for split in SPLITS:
        if not sum(counts[split].values()):
            warnings.append(f"{split}: no images assigned.")
    if skipped_no_brand:
        warnings.append(f"Skipped {skipped_no_brand} image(s) without a valid brand label.")
    if skipped_no_split:
        warnings.append(f"Skipped {skipped_no_split} labeled image(s) without a train/val/test split.")
    if missing_files:
        warnings.append(f"Skipped {missing_files} image record(s) whose source file is missing.")
    return {"archive_path": str(archive_path), "filename": f"{dataset_name}.zip",
            "counts": counts, "total": total, "warnings": warnings,
            "skipped": {"no_brand": skipped_no_brand, "no_split": skipped_no_split,
                        "missing_files": missing_files}}


def export_dataset_zip(project: str, dataset_name: str) -> dict:
    config = get_config(project)
    if not config["enabled"]:
        raise ValueError("Enable Image Classification Format before exporting")
    dataset_name = _validate_dataset_name(dataset_name)
    rows = dm.list_images(project)
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    skipped_no_brand, skipped_no_split, missing_files = [], [], []
    allowed = set(config["brands"])
    project_images = project_path(project) / "images"
    for row in rows:
        brand = row.get("classification_brand")
        split = row.get("dataset_split")
        if brand not in allowed:
            skipped_no_brand.append(row["filename"])
            continue
        if split not in SPLITS:
            skipped_no_split.append(row["filename"])
            continue
        src = project_images / row["filename"]
        if not src.is_file():
            missing_files.append(row["filename"])
            continue
        groups[(split, brand)].append({"filename": row["filename"], "source": src})

    return _write_classification_zip(config, dataset_name, groups, len(skipped_no_brand),
                                     len(skipped_no_split), len(missing_files))


def export_version_dataset_zip(project: str, version_id: int, dataset_name: str) -> dict:
    """Export the selected version's image snapshot using manually verified project brands."""
    config = get_config(project)
    if not config["enabled"]:
        raise ValueError("Enable Image Classification Format before exporting")
    dataset_name = _validate_dataset_name(dataset_name)
    version_dir = project_path(project) / "versions" / f"v{version_id}"
    metadata_path = version_dir / "version.json"
    if not metadata_path.exists():
        raise FileNotFoundError(version_dir)
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    images = {row["filename"]: row for row in dm.list_images(project)}
    version_names = metadata.get("image_filenames", [])
    source_names = metadata.get("source_image_filenames", version_names)
    source_by_version = dict(zip(version_names, source_names))
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    skipped_no_brand = skipped_no_split = missing_files = 0
    allowed = set(config["brands"])
    for version_name in version_names:
        source_name = source_by_version.get(version_name, version_name)
        row = images.get(source_name, {})
        brand = row.get("classification_brand")
        split = metadata.get("image_splits", {}).get(version_name)
        image_path = version_dir / "images" / version_name
        if brand not in allowed:
            skipped_no_brand += 1
            continue
        if split not in SPLITS:
            skipped_no_split += 1
            continue
        if not image_path.is_file():
            missing_files += 1
            continue
        groups[(split, brand)].append({"filename": version_name, "source": image_path})
    return _write_classification_zip(config, dataset_name, groups, skipped_no_brand,
                                     skipped_no_split, missing_files)
