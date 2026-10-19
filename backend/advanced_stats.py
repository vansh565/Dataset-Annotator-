"""Extended statistics: box-size histogram, resolution histogram, imbalance."""
from __future__ import annotations
import json
import sqlite3
from pathlib import Path

from .project_manager import project_path, load_classes


def _db(project: str) -> sqlite3.Connection:
    con = sqlite3.connect(project_path(project) / "annotations.db")
    con.row_factory = sqlite3.Row
    return con


def compute(project: str) -> dict:
    con = _db(project)
    classes = load_classes(project)
    names = {c["id"]: c["name"] for c in classes}

    # box areas
    areas = []
    per_class = {}
    for row in con.execute("SELECT class_id, data FROM annotations WHERE type='box'"):
        d = json.loads(row["data"])
        a = float(d.get("w", 0)) * float(d.get("h", 0))
        areas.append(a)
        per_class.setdefault(row["class_id"], []).append(a)

    # resolution histogram
    res = [dict(r) for r in con.execute(
        "SELECT width,height,COUNT(*) c FROM images GROUP BY width,height "
        "ORDER BY c DESC")]

    # class imbalance (ratio max/min count)
    counts = [len(v) for v in per_class.values()] or [0]
    imbalance = (max(counts) / min(counts)) if min(counts) > 0 else None

    # histogram helper
    def hist(vals, bins=10):
        if not vals: return []
        lo, hi = min(vals), max(vals)
        if hi <= lo: hi = lo + 1e-9
        step = (hi - lo) / bins
        buckets = [0]*bins
        for v in vals:
            i = min(bins-1, int((v-lo)/step))
            buckets[i] += 1
        return [{"lo": lo+i*step, "hi": lo+(i+1)*step, "count": buckets[i]}
                for i in range(bins)]

    con.close()
    return {
        "class_names": names,
        "box_area_histogram": hist(areas, 12),
        "per_class_area_histogram": {
            names.get(cid, str(cid)): hist(v, 8) for cid, v in per_class.items()
        },
        "resolution_histogram": res,
        "imbalance_ratio": imbalance,
        "total_boxes": len(areas),
    }
