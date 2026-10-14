"""Import images, generate thumbnails, dataset statistics."""
from __future__ import annotations
import io
import json
import sqlite3
import time
import zipfile
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image

from .project_manager import project_path, load_classes

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
VIDEO_EXTS = {".mp4", ".avi", ".mov", ".mkv"}


def _db(name: str) -> sqlite3.Connection:
    # Imports and UI refreshes can touch the same project at nearly the same
    # time. Wait for an in-flight write instead of failing immediately.
    con = sqlite3.connect(project_path(name) / "annotations.db", timeout=30)
    con.execute("PRAGMA busy_timeout = 30000")
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    columns = {row[1] for row in con.execute("PRAGMA table_info(images)")}
    if "dataset_split" not in columns:
        con.execute("ALTER TABLE images ADD COLUMN dataset_split TEXT")
        con.commit()
    return con


def _thumb_path(project: str, filename: str) -> Path:
    stem = Path(filename).stem
    return project_path(project) / "thumbs" / f"{stem}.jpg"


def _make_thumb(src: Path, dst: Path, max_side: int = 220) -> None:
    try:
        with Image.open(src) as im:
            im = im.convert("RGB")
            im.thumbnail((max_side, max_side))
            dst.parent.mkdir(parents=True, exist_ok=True)
            im.save(dst, "JPEG", quality=80)
    except Exception:
        pass


def import_files(project: str, paths: Iterable[str]) -> dict:
    p = project_path(project)
    imgs_dir = p / "images"
    con = _db(project)
    added, skipped = 0, 0
    for src in paths:
        src = Path(src)
        if not src.exists() or src.suffix.lower() not in IMAGE_EXTS:
            skipped += 1
            continue
        target = imgs_dir / src.name
        # avoid clobber: add suffix if duplicate name with different content
        if target.exists():
            base, ext = src.stem, src.suffix
            i = 1
            while target.exists():
                target = imgs_dir / f"{base}_{i}{ext}"
                i += 1
        target.write_bytes(src.read_bytes())

        try:
            with Image.open(target) as im:
                w, h = im.size
        except Exception:
            skipped += 1
            continue

        con.execute(
            "INSERT OR IGNORE INTO images(filename,width,height,size_bytes,added_at) "
            "VALUES (?,?,?,?,?)",
            (target.name, w, h, target.stat().st_size, time.time()),
        )
        added += 1
        _make_thumb(target, _thumb_path(project, target.name))

    con.commit()
    con.close()
    return {"added": added, "skipped": skipped}


def import_zip(project: str, zip_path) -> dict:
    # Paths pasted from Explorer or copied from a quoted command are often
    # wrapped in matching quotes. Those quotes are not part of the filename.
    if hasattr(zip_path, "read"):
        archive = zip_path
    else:
        zip_path = str(zip_path).strip().strip('"').strip("'")
        if not zip_path:
            raise ValueError("Choose a ZIP file to import.")
        archive_path = Path(zip_path).expanduser()
        if not archive_path.is_file():
            raise FileNotFoundError(f"ZIP file not found: {archive_path}")
        archive = archive_path
    p = project_path(project)
    imgs_dir = p / "images"
    added = skipped = 0
    annotated = 0
    with zipfile.ZipFile(archive) as zf:
        # YOLO archives commonly store labels beside images in train/labels,
        # valid/labels, or labels. Match by image stem after flattening paths.
        labels_by_stem = {}
        for info in zf.infolist():
            member = Path(info.filename.replace("\\", "/"))
            if not info.is_dir() and member.suffix.lower() == ".txt" and "labels" in member.parts:
                labels_by_stem[member.stem.casefold()] = zf.read(info).decode("utf-8-sig", errors="replace")
        con = _db(project)
        for info in zf.infolist():
            if info.is_dir():
                continue
            name = Path(info.filename.replace("\\", "/")).name
            ext = Path(name).suffix.lower()
            if ext not in IMAGE_EXTS:
                skipped += 1
                continue
            target = imgs_dir / name
            if target.exists():
                base, e = Path(name).stem, Path(name).suffix
                i = 1
                while target.exists():
                    target = imgs_dir / f"{base}_{i}{e}"
                    i += 1
            data = zf.read(info)
            target.write_bytes(data)
            try:
                with Image.open(io.BytesIO(data)) as im:
                    w, h = im.size
            except Exception:
                skipped += 1
                continue
            con.execute(
                "INSERT OR IGNORE INTO images(filename,width,height,size_bytes,added_at) "
                "VALUES (?,?,?,?,?)",
                (target.name, w, h, target.stat().st_size, time.time()),
            )
            added += 1
            _make_thumb(target, _thumb_path(project, target.name))
            label_text = labels_by_stem.get(Path(name).stem.casefold())
            if label_text is not None:
                anns = []
                for line in label_text.splitlines():
                    parts = line.split()
                    if len(parts) < 5:
                        continue
                    try:
                        cid = int(parts[0])
                        vals = list(map(float, parts[1:]))
                    except ValueError:
                        continue
                    if len(vals) == 4:
                        cx, cy, w, h = vals
                        anns.append({"type": "box", "class_id": cid, "confidence": 1.0,
                                     "x": cx - w / 2, "y": cy - h / 2, "w": w, "h": h})
                    elif len(vals) >= 6 and len(vals) % 2 == 0:
                        anns.append({"type": "polygon", "class_id": cid, "confidence": 1.0,
                                     "points": list(zip(vals[0::2], vals[1::2]))})
                if anns:
                    image_row = con.execute("SELECT id FROM images WHERE filename=?", (target.name,)).fetchone()
                    con.executemany(
                        "INSERT INTO annotations(image_id,type,class_id,data,confidence) VALUES (?,?,?,?,?)",
                        [(image_row["id"], a["type"], a["class_id"],
                          json.dumps({k: v for k, v in a.items() if k not in ("type", "class_id", "confidence")}),
                          a["confidence"]) for a in anns],
                    )
                    (p / "labels" / f"{target.stem}.txt").write_text(
                        "\n".join(" ".join(line.split()) for line in label_text.splitlines() if line.strip()) + "\n",
                        encoding="utf-8")
                    annotated += 1
    con.commit()
    con.close()
    return {"added": added, "skipped": skipped, "annotated": annotated}


def list_images(project: str, query: str = "", only_unannotated: bool = False,
                reviewed: int | None = None,
                annotation_status: str | None = None,
                dataset_split: str | None = None) -> list[dict]:
    con = _db(project)
    sql = """
        SELECT i.*, COUNT(a.id) AS ann_count
        FROM images i
        LEFT JOIN annotations a ON a.image_id = i.id
    """
    where, params = [], []
    if query:
        where.append("i.filename LIKE ?")
        params.append(f"%{query}%")
    if reviewed is not None:
        where.append("i.reviewed = ?")
        params.append(reviewed)
    if dataset_split in ("train", "val", "test"):
        where.append("i.dataset_split = ?")
        params.append(dataset_split)
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " GROUP BY i.id"
    if annotation_status == "annotated":
        sql += " HAVING ann_count > 0"
    elif annotation_status == "unannotated" or only_unannotated:
        sql += " HAVING ann_count = 0"
    sql += " ORDER BY i.filename"
    rows = [dict(r) for r in con.execute(sql, params).fetchall()]
    con.close()
    return rows


def get_image_path(project: str, filename: str) -> Path:
    return project_path(project) / "images" / filename


def get_thumb_path(project: str, filename: str) -> Path:
    return _thumb_path(project, filename)


def delete_images(project: str, filenames: list[str]) -> int:
    p = project_path(project)
    con = _db(project)
    n = 0
    for fn in filenames:
        row = con.execute("SELECT id FROM images WHERE filename=?", (fn,)).fetchone()
        if not row:
            continue
        con.execute("DELETE FROM images WHERE id=?", (row["id"],))
        img = p / "images" / fn
        if img.exists():
            img.unlink()
        th = _thumb_path(project, fn)
        if th.exists():
            th.unlink()
        n += 1
    con.commit()
    con.close()
    return n


def set_reviewed(project: str, filename: str, reviewed: bool) -> None:
    con = _db(project)
    con.execute("UPDATE images SET reviewed=? WHERE filename=?",
                (1 if reviewed else 0, filename))
    con.commit()
    con.close()


def set_dataset_split(project: str, filename: str, split: str | None) -> None:
    if split not in (None, "train", "val", "test"):
        raise ValueError("split must be train, val, test, or null")
    con = _db(project)
    cur = con.execute("UPDATE images SET dataset_split=? WHERE filename=?",
                      (split, filename))
    if cur.rowcount == 0:
        con.close()
        raise FileNotFoundError(filename)
    con.commit()
    con.close()


def stats(project: str) -> dict:
    con = _db(project)
    total = con.execute("SELECT COUNT(*) c FROM images").fetchone()["c"]
    annotated = con.execute(
        "SELECT COUNT(DISTINCT image_id) c FROM annotations"
    ).fetchone()["c"]
    total_ann = con.execute("SELECT COUNT(*) c FROM annotations").fetchone()["c"]
    reviewed = con.execute(
        "SELECT COUNT(*) c FROM images WHERE reviewed=1"
    ).fetchone()["c"]
    per_class_rows = con.execute(
        "SELECT class_id, COUNT(*) c FROM annotations GROUP BY class_id"
    ).fetchall()
    per_class = {r["class_id"]: r["c"] for r in per_class_rows}

    # resolution distribution
    res_rows = con.execute(
        "SELECT width,height,COUNT(*) c FROM images GROUP BY width,height "
        "ORDER BY c DESC LIMIT 10"
    ).fetchall()
    resolutions = [dict(r) for r in res_rows]

    # total dataset size
    size_bytes = 0
    for r in con.execute("SELECT filename FROM images"):
        f = project_path(project) / "images" / r["filename"]
        if f.exists():
            size_bytes += f.stat().st_size

    con.close()
    classes = load_classes(project)
    per_class_named = [
        {"id": c["id"], "name": c["name"], "color": c.get("color"),
         "count": per_class.get(c["id"], 0)}
        for c in classes
    ]

    return {
        "total_images": total,
        "annotated_images": annotated,
        "unannotated_images": total - annotated,
        "reviewed_images": reviewed,
        "total_annotations": total_ann,
        "total_classes": len(classes),
        "avg_objects_per_image": round(total_ann / total, 3) if total else 0,
        "per_class": per_class_named,
        "resolutions": resolutions,
        "size_bytes": size_bytes,
    }
