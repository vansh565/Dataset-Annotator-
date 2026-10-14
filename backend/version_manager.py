"""Local dataset version snapshots (equivalent to Roboflow 'Create Version')."""
from __future__ import annotations
import json
import sqlite3
import shutil
import time
import zipfile
from pathlib import Path
from typing import Any

from .project_manager import project_path, load_classes


def versions_dir(project: str) -> Path:
    d = project_path(project) / "versions"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _next_version_id(project: str) -> int:
    d = versions_dir(project)
    ids = []
    for sub in d.iterdir():
        if sub.is_dir() and sub.name.startswith("v"):
            try:
                ids.append(int(sub.name[1:]))
            except ValueError:
                pass
    return (max(ids) + 1) if ids else 1


def _preprocess_image(image_path: Path, preprocessing: list[dict[str, Any]]) -> None:
    """Apply version transforms in-place to the version copy only."""
    resize = next((item for item in preprocessing if item.get("name") == "Resize"), None)
    auto_orient = any(item.get("name") == "Auto-orient" for item in preprocessing)
    if resize is None and not auto_orient:
        return

    from PIL import Image, ImageOps

    temporary = image_path.with_name("." + image_path.stem + ".preprocess" + image_path.suffix)
    try:
        with Image.open(image_path) as source:
            image = ImageOps.exif_transpose(source) if auto_orient else source.copy()
            image_format = source.format
            if resize is not None:
                width = int(resize.get("width", 224))
                height = int(resize.get("height", 224))
                resampling = getattr(Image, "Resampling", Image)
                image = image.resize((width, height), resampling.LANCZOS)
            image.save(temporary, format=image_format)
        temporary.replace(image_path)
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError(f"Could not preprocess image {image_path.name}: {exc}") from exc
    finally:
        if temporary.exists():
            temporary.unlink()


def create_version(project: str, note: str = "", split: dict[str, float] | None = None,
                   preprocessing: list[dict[str, Any]] | None = None,
                   augmentations: list[dict[str, Any]] | None = None,
                   image_format: str = "original") -> dict[str, Any]:
    """Snapshot annotated images, labels, and classes into versions/vN/."""
    p = project_path(project)
    con = sqlite3.connect(p / "annotations.db")
    columns = {row[1] for row in con.execute("PRAGMA table_info(images)")}
    if "dataset_split" not in columns:
        con.execute("ALTER TABLE images ADD COLUMN dataset_split TEXT")
        con.commit()
    annotated_rows = con.execute(
        "SELECT DISTINCT i.filename, i.dataset_split FROM images i "
        "JOIN annotations a ON a.image_id = i.id ORDER BY i.filename"
    ).fetchall()
    total_images = con.execute("SELECT COUNT(*) FROM images").fetchone()[0]
    con.close()
    source_images = [p / "images" / row[0] for row in annotated_rows
                     if (p / "images" / row[0]).is_file()]
    if not source_images:
        raise ValueError("No annotated images to create a version")
    requested_format = (image_format or "original").strip().lower()
    format_names = {"original": None, "jpg": "JPEG", "jpeg": "JPEG", "png": "PNG"}
    if requested_format not in format_names:
        raise ValueError("Image format must be original, JPG, or PNG")
    output_format = format_names[requested_format]
    preprocessing = preprocessing or []
    resize_spec = next((item for item in preprocessing if item.get("name") == "Resize"), None)
    if resize_spec is not None:
        try:
            width = int(resize_spec.get("width", 224))
            height = int(resize_spec.get("height", 224))
        except (TypeError, ValueError) as exc:
            raise ValueError("Resize width and height must be whole numbers") from exc
        if width < 32 or height < 32 or width > 8192 or height > 8192:
            raise ValueError("Resize width and height must be between 32 and 8192 pixels")
        resize_spec["width"], resize_spec["height"] = width, height
    ratios = split or {"train": 0.7, "val": 0.2, "test": 0.1}
    image_splits = _assign_splits(annotated_rows, ratios)

    vid = _next_version_id(project)
    vname = f"v{vid}"
    vdir = versions_dir(project) / vname
    if vdir.exists():
        raise FileExistsError(vname)

    def output_name(source: Path) -> str:
        if output_format == "JPEG":
            return source.stem + ".jpg"
        if output_format == "PNG":
            return source.stem + ".png"
        return source.name

    output_names = [output_name(source) for source in source_images]
    if len(set(output_names)) != len(output_names):
        raise ValueError("Image conversion would create duplicate filenames; rename images with duplicate stems first")
    version_image_splits = {
        output_name(Path(source_name)): split_name
        for source_name, split_name in image_splits.items()
    }

    (vdir / "images").mkdir(parents=True)
    (vdir / "labels").mkdir(parents=True)

    img_count = lbl_count = 0
    image_stems = set()
    version_filenames = []
    for f in source_images:
        try:
            version_filename = output_name(f)
            version_image = vdir / "images" / version_filename
            if output_format:
                from PIL import Image
                with Image.open(f) as source:
                    image = source.copy()
                    if output_format == "JPEG":
                        if image.mode in ("RGBA", "LA") or "transparency" in image.info:
                            rgba = image.convert("RGBA")
                            background = Image.new("RGB", rgba.size, (255, 255, 255))
                            background.paste(rgba, mask=rgba.getchannel("A"))
                            image = background
                        else:
                            image = image.convert("RGB")
                    elif image.mode not in ("1", "L", "LA", "P", "RGB", "RGBA", "I", "I;16"):
                        image = image.convert("RGB")
                    image.save(version_image, format=output_format)
            else:
                shutil.copy2(f, version_image)
            _preprocess_image(version_image, preprocessing)
        except Exception:
            shutil.rmtree(vdir, ignore_errors=True)
            raise
        image_stems.add(f.stem)
        version_filenames.append(version_filename)
        img_count += 1
    for f in (p / "labels").iterdir():
        if f.is_file() and f.stem in image_stems:
            shutil.copy2(f, vdir / "labels" / f.name)
            lbl_count += 1

    classes = load_classes(project)
    (vdir / "classes.json").write_text(json.dumps(classes, indent=2), encoding="utf-8")

    meta = {
        "id": vid,
        "name": vname,
        "note": note,
        "created_at": time.time(),
        "images": img_count,
        "image_filenames": version_filenames,
        "source_image_filenames": [f.name for f in source_images],
        "image_splits": version_image_splits,
        "source_image_splits": image_splits,
        "split_counts": {key: list(image_splits.values()).count(key)
                         for key in ("train", "val", "test")},
        "source_images": total_images,
        "annotated_only": True,
        "labels": lbl_count,
        "classes": len(classes),
        "split": split or {"train": 0.7, "val": 0.2, "test": 0.1},
        "preprocessing": preprocessing,
        "images_preprocessed": bool(preprocessing) or bool(output_format),
        "image_format": output_format or "original",
        "augmentations": augmentations or [],
    }
    (vdir / "version.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return meta


def _assign_splits(rows: list[Any], ratios: dict[str, float]) -> dict[str, str]:
    """Keep manual image assignments and distribute the remaining images by ratio."""
    import random

    names = [row[0] for row in rows]
    ratio_values = [max(0.0, float(ratios.get(key, 0)))
                    for key in ("train", "val", "test")]
    total_ratio = sum(ratio_values) or 1.0
    ratio_values = [value / total_ratio for value in ratio_values]
    total = len(names)
    targets = {
        "train": int(total * ratio_values[0]),
        "val": int(total * ratio_values[1]),
    }
    targets["test"] = total - targets["train"] - targets["val"]
    result = {row[0]: row[1] for row in rows if row[1] in ("train", "val", "test")}
    counts = {key: sum(1 for value in result.values() if value == key)
              for key in ("train", "val", "test")}
    remaining = [name for name in names if name not in result]
    random.Random(42).shuffle(remaining)
    for name in remaining:
        target = max(("train", "val", "test"),
                     key=lambda key: (targets[key] - counts[key], -("train", "val", "test").index(key)))
        result[name] = target
        counts[target] += 1
    return result


def list_versions(project: str) -> list[dict[str, Any]]:
    d = versions_dir(project)
    out = []
    for sub in sorted(d.iterdir(), key=lambda x: x.name):
        meta_file = sub / "version.json"
        if sub.is_dir() and meta_file.exists():
            try:
                out.append(json.loads(meta_file.read_text(encoding="utf-8")))
            except Exception:
                pass
    return sorted(out, key=lambda m: m["id"])


def get_version(project: str, vid: int) -> dict[str, Any]:
    meta_file = versions_dir(project) / f"v{vid}" / "version.json"
    if not meta_file.exists():
        raise FileNotFoundError(f"v{vid}")
    return json.loads(meta_file.read_text(encoding="utf-8"))


def delete_version(project: str, vid: int) -> None:
    d = versions_dir(project) / f"v{vid}"
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)


def export_version_zip(project: str, vid: int) -> str:
    """Bundle a version as a portable zip (images/, labels/, classes.json, version.json)."""
    vdir = versions_dir(project) / f"v{vid}"
    if not vdir.exists():
        raise FileNotFoundError(vdir)
    from .project_manager import BASE_DIR
    out_dir = BASE_DIR / "exports"
    out_dir.mkdir(exist_ok=True)
    zip_path = out_dir / f"{project_path(project).name}_{vdir.name}.zip"
    if zip_path.exists():
        try:
            zip_path.unlink()
        except PermissionError:
            zip_path = out_dir / f"{project_path(project).name}_{vdir.name}_{int(time.time())}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in vdir.rglob("*"):
            if f.is_file():
                zf.write(f, f.relative_to(vdir))
    return str(zip_path)


def export_version_yolo(project: str, vid: int,
                        split: bool = False,
                        ratios: tuple[float, float, float] = (0.7, 0.2, 0.1),
                        seed: int = 42) -> str:
    """Export a saved version to a YOLO dataset (optionally split)."""
    import random, yaml
    from .project_manager import BASE_DIR

    vdir = versions_dir(project) / f"v{vid}"
    if not vdir.exists():
        raise FileNotFoundError(vdir)

    classes = json.loads((vdir / "classes.json").read_text(encoding="utf-8"))
    meta = get_version(project, vid)
    # New versions already contain preprocessed image copies. Keep support for
    # older snapshots that recorded Resize but stored the original dimensions.
    resize = None if meta.get("images_preprocessed") else next(
        (item for item in meta.get("preprocessing", [])
         if item.get("name") == "Resize"), None
    )
    if split and "split" in meta and ratios == (0.7, 0.2, 0.1):
        saved = meta["split"]
        ratios = (float(saved.get("train", ratios[0])),
                  float(saved.get("val", ratios[1])),
                  float(saved.get("test", ratios[2])))
    out_root = BASE_DIR / "exports"
    out_root.mkdir(exist_ok=True)
    out = out_root / f"{project_path(project).name}_{vdir.name}_yolo"
    if out.exists():
        shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True, exist_ok=True)

    images = sorted([f for f in (vdir / "images").iterdir() if f.is_file()])

    def _copy_pair(img: Path, sub: str | None = None):
        img_dst_dir = out / "images" / (sub or "")
        lbl_dst_dir = out / "labels" / (sub or "")
        img_dst_dir.mkdir(parents=True, exist_ok=True)
        lbl_dst_dir.mkdir(parents=True, exist_ok=True)
        if resize and resize.get("width") and resize.get("height"):
            from PIL import Image
            with Image.open(img) as source:
                source.resize((int(resize["width"]), int(resize["height"]))).save(
                    img_dst_dir / img.name
                )
        else:
            shutil.copy2(img, img_dst_dir / img.name)
        lbl = vdir / "labels" / (img.stem + ".txt")
        if lbl.exists():
            shutil.copy2(lbl, lbl_dst_dir / lbl.name)

    if split and meta.get("image_splits"):
        split_groups = {key: [] for key in ("train", "val", "test")}
        assignments = meta["image_splits"]
        for image in images:
            split_groups.get(assignments.get(image.name, "train"), split_groups["train"]).append(image)
        for key, group in split_groups.items():
            for img in group:
                _copy_pair(img, key)
    elif split:
        rng = random.Random(seed)
        rng.shuffle(images)
        n = len(images)
        n_tr = int(n * ratios[0]); n_va = int(n * ratios[1])
        for img in images[:n_tr]: _copy_pair(img, "train")
        for img in images[n_tr:n_tr+n_va]: _copy_pair(img, "val")
        for img in images[n_tr+n_va:]: _copy_pair(img, "test")
    else:
        for img in images: _copy_pair(img)

    data = {
        "path": str(out.resolve()),
        "train": "images/train" if split else "images",
        "val":   "images/val"   if split else "images",
    }
    if split:
        data["test"] = "images/test"
    data["names"] = {c["id"]: c["name"] for c in classes}
    (out / "data.yaml").write_text(
        yaml.safe_dump(data, sort_keys=False, allow_unicode=True), encoding="utf-8"
    )

    zip_path = out_root / f"{out.name}.zip"
    if zip_path.exists():
        try: zip_path.unlink()
        except PermissionError: pass
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in out.rglob("*"):
            if f.is_file():
                zf.write(f, f.relative_to(out))
    return str(zip_path)
