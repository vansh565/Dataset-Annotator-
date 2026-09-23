"""Free-form tags on images. Stored in the SQLite images table via a side table."""
from __future__ import annotations
import sqlite3
from .project_manager import project_path


def _db(project: str) -> sqlite3.Connection:
    con = sqlite3.connect(project_path(project) / "annotations.db")
    con.row_factory = sqlite3.Row
    con.execute("""CREATE TABLE IF NOT EXISTS image_tags (
        image_id INTEGER NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY(image_id, tag)
    )""")
    con.commit()
    return con


def add_tag(project: str, filename: str, tag: str) -> None:
    con = _db(project)
    row = con.execute("SELECT id FROM images WHERE filename=?", (filename,)).fetchone()
    if row:
        con.execute("INSERT OR IGNORE INTO image_tags(image_id, tag) VALUES (?,?)",
                    (row["id"], tag))
        con.commit()
    con.close()


def remove_tag(project: str, filename: str, tag: str) -> None:
    con = _db(project)
    row = con.execute("SELECT id FROM images WHERE filename=?", (filename,)).fetchone()
    if row:
        con.execute("DELETE FROM image_tags WHERE image_id=? AND tag=?",
                    (row["id"], tag))
        con.commit()
    con.close()


def get_tags(project: str, filename: str) -> list[str]:
    con = _db(project)
    row = con.execute("SELECT id FROM images WHERE filename=?", (filename,)).fetchone()
    if not row:
        con.close(); return []
    rows = con.execute("SELECT tag FROM image_tags WHERE image_id=?",
                       (row["id"],)).fetchall()
    con.close()
    return [r["tag"] for r in rows]


def list_all_tags(project: str) -> list[dict]:
    con = _db(project)
    rows = con.execute("SELECT tag, COUNT(*) c FROM image_tags GROUP BY tag ORDER BY c DESC").fetchall()
    con.close()
    return [dict(r) for r in rows]


def list_images_with_tag(project: str, tag: str) -> list[str]:
    con = _db(project)
    rows = con.execute(
        "SELECT i.filename FROM images i JOIN image_tags t ON t.image_id=i.id "
        "WHERE t.tag=?", (tag,)
    ).fetchall()
    con.close()
    return [r["filename"] for r in rows]