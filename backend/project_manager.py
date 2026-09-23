"""Project creation, listing, and metadata management (all local)."""
from __future__ import annotations
import json
import os
import sqlite3
import time
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent.parent
PROJECTS_DIR = BASE_DIR / "projects"
PROJECTS_DIR.mkdir(parents=True, exist_ok=True)


def _safe_name(name: str) -> str:
    keep = "-_ .abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    cleaned = "".join(c for c in name if c in keep).strip().replace(" ", "_")
    return cleaned or f"project_{int(time.time())}"


def project_path(name: str) -> Path:
    return PROJECTS_DIR / _safe_name(name)


def _default_classes() -> list[dict[str, Any]]:
    return [
        {"id": 0, "name": "person", "color": "#ff5c5c"},
        {"id": 1, "name": "car", "color": "#5c9dff"},
    ]


def _init_db(p: Path) -> None:
    con = sqlite3.connect(p / "annotations.db")
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT UNIQUE NOT NULL,
            width INTEGER,
            height INTEGER,
            size_bytes INTEGER,
            reviewed INTEGER DEFAULT 0,
            dataset_split TEXT,
            notes TEXT DEFAULT '',
            added_at REAL
        );
        CREATE TABLE IF NOT EXISTS annotations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            image_id INTEGER NOT NULL,
            type TEXT NOT NULL,              -- box | polygon | obb | mask | keypoint
            class_id INTEGER NOT NULL,
            data TEXT NOT NULL,              -- JSON payload
            confidence REAL DEFAULT 1.0,
            FOREIGN KEY(image_id) REFERENCES images(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_ann_image ON annotations(image_id);
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        """
    )
    con.commit()
    con.close()


def create_project(name: str, description: str = "") -> dict[str, Any]:
    p = project_path(name)
    if p.exists():
        raise FileExistsError(f"Project '{p.name}' already exists")
    for sub in ("images", "labels", "thumbs"):
        (p / sub).mkdir(parents=True, exist_ok=True)

    classes = _default_classes()
    (p / "classes.json").write_text(json.dumps(classes, indent=2), encoding="utf-8")

    meta = {
        "name": p.name,
        "description": description,
        "created_at": time.time(),
        "version": 1,
    }
    (p / "project.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    _init_db(p)
    return meta


def list_projects() -> list[dict[str, Any]]:
    out = []
    for d in sorted(PROJECTS_DIR.iterdir()):
        if d.is_dir() and (d / "project.json").exists():
            try:
                meta = json.loads((d / "project.json").read_text(encoding="utf-8"))
                meta["path"] = str(d)
                out.append(meta)
            except Exception:
                continue
    return out


def load_project(name: str) -> dict[str, Any]:
    p = project_path(name)
    if not (p / "project.json").exists():
        raise FileNotFoundError(name)
    meta = json.loads((p / "project.json").read_text(encoding="utf-8"))
    meta["classes"] = load_classes(name)
    return meta


def save_project_meta(name: str, meta: dict[str, Any]) -> None:
    p = project_path(name)
    (p / "project.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")


def load_classes(name: str) -> list[dict[str, Any]]:
    p = project_path(name) / "classes.json"
    if not p.exists():
        return _default_classes()
    classes = json.loads(p.read_text(encoding="utf-8"))
    seen: dict[str, int] = {}
    changed = False
    for index, cls in enumerate(classes):
        cls["id"] = int(cls.get("id", index))
        base = str(cls.get("name", "class " + str(cls["id"]))).strip() or "class " + str(cls["id"])
        key = base.casefold()
        seen[key] = seen.get(key, 0) + 1
        if seen[key] > 1:
            cls["name"] = base + " " + str(seen[key])
            changed = True
        else:
            cls["name"] = base
    if changed:
        p.write_text(json.dumps(classes, indent=2), encoding="utf-8")
    return classes


def save_classes(name: str, classes: list[dict[str, Any]]) -> None:
    # Keep identifiers stable while rejecting duplicate names.
    seen = set()
    for i, c in enumerate(classes):
        c["id"] = int(c.get("id", i))
        c["name"] = str(c.get("name", "class " + str(c["id"]))).strip()
        key = c["name"].casefold()
        if not c["name"] or key in seen:
            raise ValueError("class names must be unique")
        seen.add(key)
    (project_path(name) / "classes.json").write_text(
        json.dumps(classes, indent=2), encoding="utf-8"
    )


def delete_project(name: str) -> None:
    import shutil
    p = project_path(name)
    if p.exists():
        shutil.rmtree(p)
