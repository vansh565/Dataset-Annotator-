"""Run local YOLO checkpoints on user supplied images and videos."""
from __future__ import annotations

import base64
import re
import uuid
from pathlib import Path

from .project_manager import BASE_DIR
from . import model_manager as mm

TEST_DIR = BASE_DIR / "runs" / "model_tests"
TEST_DIR.mkdir(parents=True, exist_ok=True)
_VIDEO_ID = re.compile(r"^[a-f0-9]{32}$")
_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"}
_VIDEO_EXTS = {".mp4", ".avi", ".mov", ".mkv", ".webm", ".m4v"}


def _predictions(result) -> list[dict]:
    out = []
    if result.boxes is None:
        return out
    names = result.names or {}
    for box in result.boxes:
        class_id = int(box.cls.item())
        out.append({
            "class_id": class_id,
            "class_name": names.get(class_id, str(class_id)),
            "confidence": float(box.conf.item()),
            "xyxy": [float(value) for value in box.xyxy[0].tolist()],
        })
    return out


def predict_upload(upload, model_path: str, conf: float = 0.25,
                   iou: float = 0.45) -> dict:
    """Predict on one uploaded image or video and return a browser preview."""
    import cv2

    suffix = Path(upload.filename or "").suffix.lower()
    if suffix not in _IMAGE_EXTS | _VIDEO_EXTS:
        raise ValueError("Choose a supported image or video file")
    token = uuid.uuid4().hex
    source = TEST_DIR / (token + suffix)
    upload.save(source)
    try:
        with mm._MODEL_LOCK:
            model = mm.load_model(model_path)
            if suffix in _IMAGE_EXTS:
                result = model.predict(str(source), conf=conf, iou=iou,
                                       verbose=False)[0]
                ok, encoded = cv2.imencode(".jpg", result.plot())
                if not ok:
                    raise RuntimeError("Could not encode the annotated image")
                return {
                    "kind": "image",
                    "preview": "data:image/jpeg;base64," +
                               base64.b64encode(encoded.tobytes()).decode("ascii"),
                    "width": int(result.orig_shape[1]),
                    "height": int(result.orig_shape[0]),
                    "predictions": _predictions(result),
                }

            output = TEST_DIR / (token + "_annotated.mp4")
            capture = cv2.VideoCapture(str(source))
            if not capture.isOpened():
                raise ValueError("Could not open the uploaded video")
            fps = capture.get(cv2.CAP_PROP_FPS) or 25.0
            width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
            writer = cv2.VideoWriter(
                str(output), cv2.VideoWriter_fourcc(*"mp4v"), fps,
                (width, height),
            )
            if not writer.isOpened():
                capture.release()
                raise RuntimeError("Could not create the annotated video")
            frames = 0
            detections = 0
            try:
                while True:
                    ok, frame = capture.read()
                    if not ok:
                        break
                    result = model.predict(frame, conf=conf, iou=iou,
                                           verbose=False)[0]
                    detections += len(_predictions(result))
                    writer.write(result.plot())
                    frames += 1
            finally:
                capture.release()
                writer.release()
            if not frames:
                output.unlink(missing_ok=True)
                raise ValueError("The uploaded video contains no readable frames")
            return {
                "kind": "video",
                "video_url": "/api/model-test/video/" + token,
                "frames": frames,
                "detections": detections,
            }
    finally:
        source.unlink(missing_ok=True)


def video_path(video_id: str) -> Path:
    if not _VIDEO_ID.fullmatch(video_id):
        raise FileNotFoundError("Video not found")
    path = (TEST_DIR / (video_id + "_annotated.mp4")).resolve()
    if path.parent != TEST_DIR.resolve() or not path.is_file():
        raise FileNotFoundError("Video not found")
    return path
