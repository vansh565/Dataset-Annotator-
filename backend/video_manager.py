"""Video → frame extraction. (Annotation is done via the normal image flow.)"""
from __future__ import annotations
import cv2
from pathlib import Path

from .project_manager import project_path


def video_info(path: str) -> dict:
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        return {"error": "cannot open"}
    info = {
        "fps": cap.get(cv2.CAP_PROP_FPS),
        "frame_count": int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),
        "width": int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
        "height": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
    }
    cap.release()
    return info


def extract_frames(project: str, video_path: str, out_fps: float = 1.0,
                   prefix: str | None = None, progress_cb=None) -> int:
    """Extract frames at `out_fps` into projects/<p>/images/."""
    p = project_path(project)
    imgs = p / "images"
    imgs.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(video_path)
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30
    step = max(1, int(round(src_fps / out_fps)))
    stem = prefix or Path(video_path).stem
    saved = 0
    idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if idx % step == 0:
            fn = imgs / f"{stem}_f{idx:06d}.jpg"
            cv2.imwrite(str(fn), frame)
            saved += 1
            if progress_cb and saved % 10 == 0:
                progress_cb(saved)
        idx += 1
    cap.release()
    # register in DB
    from .dataset_manager import import_files
    import_files(project, [str(imgs / f"{stem}_f{i:06d}.jpg")
                           for i in range(0, idx, step)])
    return saved
