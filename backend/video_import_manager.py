"""Preview video frames and import only the selected frames into a dataset."""
from __future__ import annotations

import json
import re
import shutil
import time
import uuid
from pathlib import Path

import cv2
from werkzeug.utils import secure_filename

from .project_manager import project_path

VIDEO_EXTS = {".mp4", ".avi", ".mov", ".mkv", ".webm", ".m4v"}
_SESSION_RE = re.compile(r"^[a-f0-9]{32}$")
_FRAME_RE = re.compile(r"^\d{6}$")
_MAX_PREVIEW_FRAMES = 500


def _preview_root(project: str) -> Path:
    root = project_path(project) / "video_frames"
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def _session_dir(project: str, session_id: str) -> Path:
    if not _SESSION_RE.fullmatch(session_id):
        raise FileNotFoundError("Video preview session not found")
    root = _preview_root(project)
    path = (root / session_id).resolve()
    if path.parent != root or not path.is_dir():
        raise FileNotFoundError("Video preview session not found")
    return path


def create_preview(project: str, upload, fps: float) -> dict:
    if fps <= 0 or fps > 10:
        raise ValueError("Frame rate must be greater than 0 and at most 10 FPS")
    original_name = secure_filename(upload.filename or "video")
    suffix = Path(original_name).suffix.lower()
    if suffix not in VIDEO_EXTS:
        raise ValueError("Choose an MP4, AVI, MOV, MKV, WEBM, or M4V video")
    token = uuid.uuid4().hex
    safe_stem = Path(original_name).stem[:80] or "video"
    session_dir = _preview_root(project) / token
    frames_dir = session_dir / "frames"
    thumbs_dir = session_dir / "thumbs"
    frames_dir.mkdir(parents=True)
    thumbs_dir.mkdir()
    source = session_dir / ("source" + suffix)
    upload.save(source)

    capture = cv2.VideoCapture(str(source))
    if not capture.isOpened():
        shutil.rmtree(session_dir, ignore_errors=True)
        raise ValueError("Could not open the uploaded video")
    source_fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    step = max(1, int(round(source_fps / fps)))
    frames = []
    frame_index = 0
    try:
        while len(frames) < _MAX_PREVIEW_FRAMES:
            ok, frame = capture.read()
            if not ok:
                break
            if frame_index % step == 0:
                frame_id = f"{len(frames):06d}"
                frame_path = frames_dir / (frame_id + ".jpg")
                if cv2.imwrite(str(frame_path), frame):
                    thumb = frame
                    height, width = frame.shape[:2]
                    scale = min(1.0, 480.0 / max(width, height))
                    if scale < 1.0:
                        thumb = cv2.resize(frame, (int(width * scale), int(height * scale)))
                    cv2.imwrite(str(thumbs_dir / (frame_id + ".jpg")), thumb,
                                [cv2.IMWRITE_JPEG_QUALITY, 82])
                    frames.append({
                        "id": frame_id,
                        "number": frame_index,
                        "seconds": round(frame_index / source_fps, 2),
                        "width": width,
                        "height": height,
                    })
            frame_index += 1
    finally:
        capture.release()

    if not frames:
        shutil.rmtree(session_dir, ignore_errors=True)
        raise ValueError("No readable frames were found in the video")
    truncated = frame_count > 0 and len(frames) >= _MAX_PREVIEW_FRAMES and frame_index < frame_count
    metadata = {
        "session_id": token,
        "video_name": safe_stem,
        "created_at": time.time(),
        "source_fps": round(source_fps, 2),
        "sample_fps": round(fps, 2),
        "frame_count": len(frames),
        "frame_numbers": {item["id"]: item["number"] for item in frames},
        "frames": frames,
        "imported": [],
    }
    (session_dir / "metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
    return {
        "session_id": token,
        "video_name": safe_stem,
        "source_fps": round(source_fps, 2),
        "frame_count": len(frames),
        "truncated": truncated,
        "frames": frames,
    }


def _read_metadata(project: str, session_id: str) -> tuple[Path, dict]:
    session_dir = _session_dir(project, session_id)
    try:
        metadata = json.loads((session_dir / "metadata.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise FileNotFoundError("Video preview metadata not found")
    return session_dir, metadata


def list_previews(project: str) -> list[dict]:
    root = _preview_root(project)
    previews = []
    for folder in root.iterdir():
        if not folder.is_dir() or not _SESSION_RE.fullmatch(folder.name):
            continue
        try:
            metadata = json.loads((folder / "metadata.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        previews.append({key: metadata.get(key) for key in
                         ("session_id", "video_name", "created_at", "sample_fps", "frame_count")})
    return sorted(previews, key=lambda item: item.get("created_at") or 0, reverse=True)


def get_preview(project: str, session_id: str) -> dict:
    _, metadata = _read_metadata(project, session_id)
    imported = set(metadata.get("imported", []))
    frames = [dict(frame, imported=frame["id"] in imported)
              for frame in metadata.get("frames", [])]
    return {"session_id": session_id, "video_name": metadata.get("video_name", "video"),
            "frame_count": len(frames), "frames": frames}


def preview_frame_path(project: str, session_id: str, frame_name: str,
                       full_size: bool = False) -> Path:
    if not re.fullmatch(r"\d{6}\.jpg", frame_name):
        raise FileNotFoundError("Preview frame not found")
    session_dir = _session_dir(project, session_id)
    path = session_dir / ("frames" if full_size else "thumbs") / frame_name
    if not path.is_file():
        raise FileNotFoundError("Preview frame not found")
    return path


def import_selected(project: str, session_id: str, frame_ids: list[str]) -> dict:
    session_dir, metadata = _read_metadata(project, session_id)
    if not isinstance(frame_ids, list) or not frame_ids:
        raise ValueError("Select at least one frame to add")
    if len(frame_ids) > _MAX_PREVIEW_FRAMES:
        raise ValueError("Too many selected frames")
    unique_ids = list(dict.fromkeys(str(item) for item in frame_ids))
    frames_dir = session_dir / "frames"
    staged_dir = session_dir / "selected"
    staged_dir.mkdir(exist_ok=True)
    video_name = secure_filename(metadata.get("video_name", "video")) or "video"
    frame_numbers = metadata.get("frame_numbers", {})
    imported = set(metadata.get("imported", []))
    staged_paths = []
    staged_frame_ids = []
    for frame_id in unique_ids:
        if not _FRAME_RE.fullmatch(frame_id):
            raise ValueError("Invalid frame selection")
        frame_path = frames_dir / (frame_id + ".jpg")
        if not frame_path.is_file():
            raise ValueError("A selected preview frame is missing")
        if frame_id in imported:
            continue
        frame_number = int(frame_numbers.get(frame_id, frame_id))
        staged_path = staged_dir / f"{video_name}_frame_{frame_number:06d}.jpg"
        shutil.copy2(frame_path, staged_path)
        staged_paths.append(str(staged_path))
        staged_frame_ids.append(frame_id)

    if staged_paths:
        from .dataset_manager import import_files
        result = import_files(project, staged_paths)
    else:
        result = {"added": 0, "skipped": len(unique_ids)}
    if result["added"]:
        metadata["imported"] = sorted(imported.union(staged_frame_ids))
        (session_dir / "metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
    result["selected"] = len(unique_ids)
    result["remaining"] = len(metadata.get("frames", [])) - len(metadata.get("imported", []))
    return result


def discard_preview(project: str, session_id: str) -> None:
    shutil.rmtree(_session_dir(project, session_id), ignore_errors=True)
