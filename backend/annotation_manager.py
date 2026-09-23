"""CRUD for annotations + YOLO txt sync."""
from __future__ import annotations
import json
import sqlite3
from pathlib import Path
from typing import Any

from .project_manager import project_path, load_classes


def _db(project: str) -> sqlite3.Connection:
    con = sqlite3.connect(project_path(project) / "annotations.db")
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


# ---------- public API ----------

def get_annotations(project: str, filename: str) -> list[dict]:
    con = _db(project)
    img = con.execute("SELECT id FROM images WHERE filename=?", (filename,)).fetchone()
    if not img:
        con.close()
        return []
    rows = con.execute(
        "SELECT id,type,class_id,data,confidence FROM annotations WHERE image_id=?",
        (img["id"],),
    ).fetchall()
    con.close()
    out = []
    for r in rows:
        out.append({
            "id": r["id"],
            "type": r["type"],
            "class_id": r["class_id"],
            "confidence": r["confidence"],
            **json.loads(r["data"]),
        })
    return out


def save_annotations(project: str, filename: str, anns: list[dict]) -> None:
    """Full replace for the given image + rewrite YOLO txt."""
    con = _db(project)
    img = con.execute("SELECT id FROM images WHERE filename=?", (filename,)).fetchone()
    if not img:
        con.close()
        raise FileNotFoundError(filename)
    img_id = img["id"]
    con.execute("DELETE FROM annotations WHERE image_id=?", (img_id,))
    for a in anns:
        payload = {k: v for k, v in a.items()
                   if k not in ("id", "type", "class_id", "confidence")}
        con.execute(
            "INSERT INTO annotations(image_id,type,class_id,data,confidence) "
            "VALUES (?,?,?,?,?)",
            (img_id, a["type"], int(a["class_id"]),
             json.dumps(payload), float(a.get("confidence", 1.0))),
        )
    con.commit()
    con.close()
    _write_yolo_txt(project, filename, anns)


def _write_yolo_txt(project: str, filename: str, anns: list[dict]) -> None:
    p = project_path(project)
    lbl = p / "labels" / (Path(filename).stem + ".txt")
    lines = []
    for a in anns:
        t = a["type"]
        cid = int(a["class_id"])
        if t == "box":
            cx, cy = a["x"] + a["w"] / 2, a["y"] + a["h"] / 2
            lines.append(f"{cid} {cx:.6f} {cy:.6f} {a['w']:.6f} {a['h']:.6f}")
        elif t == "polygon":
            pts = " ".join(f"{px:.6f} {py:.6f}" for px, py in a["points"])
            lines.append(f"{cid} {pts}")
        elif t == "obb":
            cx, cy, w, h, r = a["cx"], a["cy"], a["w"], a["h"], a["rotation"]
            lines.append(f"{cid} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f} {r:.6f}")
        # keypoint/mask written by their own exporters later
    lbl.parent.mkdir(parents=True, exist_ok=True)
    if lines:
        lbl.write_text("\n".join(lines) + "\n", encoding="utf-8")
    elif lbl.exists():
        lbl.unlink()


def _read_yolo_txt(project: str, filename: str) -> list[dict]:
    """Import labels/ back into DB if you edited them externally."""
    p = project_path(project)
    lbl = p / "labels" / (Path(filename).stem + ".txt")
    if not lbl.exists():
        return []
    out = []
    for line in lbl.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) < 5:
            continue
        cid = int(parts[0])
        vals = list(map(float, parts[1:]))
        if len(vals) == 4:
            cx, cy, w, h = vals
            out.append({
                "type": "box", "class_id": cid, "confidence": 1.0,
                "x": cx - w / 2, "y": cy - h / 2, "w": w, "h": h,
            })
        elif len(vals) >= 6 and len(vals) % 2 == 0:
            pts = list(zip(vals[0::2], vals[1::2]))
            out.append({
                "type": "polygon", "class_id": cid, "confidence": 1.0,
                "points": pts,
            })
    return out


def sync_from_labels(project: str, filename: str) -> list[dict]:
    """If DB has no rows for image but a labels file exists, import it."""
    existing = get_annotations(project, filename)
    if existing:
        return existing
    imported = _read_yolo_txt(project, filename)
    if imported:
        save_annotations(project, filename, imported)
    return imported


def delete_annotation(project: str, filename: str, ann_id: int) -> None:
    con = _db(project)
    img = con.execute("SELECT id FROM images WHERE filename=?", (filename,)).fetchone()
    if not img:
        con.close()
        return
    con.execute("DELETE FROM annotations WHERE id=? AND image_id=?",
                (ann_id, img["id"]))
    con.commit()
    con.close()
    # rewrite txt
    save_annotations(project, filename, get_annotations(project, filename))


def class_distribution(project: str) -> dict[int, int]:
    con = _db(project)
    rows = con.execute(
        "SELECT class_id, COUNT(*) c FROM annotations GROUP BY class_id"
    ).fetchall()
    con.close()
    return {r["class_id"]: r["c"] for r in rows}