"""Object tracking placeholder that uses Ultralytics track() with ByteTrack/BoT-SORT.
Full video-level propagation is invoked from the API; annotations are written per frame."""
from __future__ import annotations
from pathlib import Path

from .project_manager import project_path, load_classes
from .dataset_manager import get_image_path
from .annotation_manager import get_annotations, save_annotations


def track_video(project: str, frame_filenames: list[str], model_path: str,
                tracker: str = "bytetrack.yaml", conf: float = 0.3,
                iou: float = 0.5) -> dict:
    """Runs Ultralytics track() across ordered frame filenames, writes boxes with track_id."""
    from ultralytics import YOLO
    model = YOLO(model_path)
    results_log = []
    prev_ann: dict[int, dict] = {}

    for fn in frame_filenames:
        img_path = get_image_path(project, fn)
        results = model.track(
            source=str(img_path), persist=True, tracker=tracker,
            conf=conf, iou=iou, verbose=False,
        )
        if not results:
            results_log.append({"filename": fn, "tracks": 0})
            continue
        r = results[0]
        h, w = r.orig_shape
        anns = []
        if r.boxes is not None and r.boxes.id is not None:
            for b in r.boxes:
                tid = int(b.id.item())
                cid = int(b.cls.item())
                x1, y1, x2, y2 = b.xyxy[0].tolist()
                ann = {
                    "type": "box", "class_id": cid,
                    "x": x1 / w, "y": y1 / h,
                    "w": (x2 - x1) / w, "h": (y2 - y1) / h,
                    "confidence": float(b.conf.item()),
                    "track_id": tid,
                }
                anns.append(ann)
                prev_ann[tid] = ann
        save_annotations(project, fn, anns)
        results_log.append({"filename": fn, "tracks": len(anns)})

    return {"frames": len(frame_filenames), "log": results_log}
