"""Vertex · local annotation workstation server.

Run:  python app.py
Then: http://localhost:5000
Inference micro-server (optional): http://127.0.0.1:5001

No cloud, no login, no telemetry.
"""
from __future__ import annotations

import os
import threading
import time
import webbrowser
from pathlib import Path

from flask import (Flask, jsonify, request, send_file, render_template,
                   send_from_directory, abort)
from flask_cors import CORS

# ------------------------------------------------------------------ paths
BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
TEMPLATE_DIR = BASE_DIR / "templates"

print(f"[startup] BASE_DIR     = {BASE_DIR}")
print(f"[startup] STATIC_DIR   = {STATIC_DIR}  exists={STATIC_DIR.exists()}")
print(f"[startup] TEMPLATE_DIR = {TEMPLATE_DIR}  exists={TEMPLATE_DIR.exists()}")
if STATIC_DIR.exists():
    for f in sorted(STATIC_DIR.rglob("*")):
        if f.is_file():
            print(f"[startup]   static file: {f.relative_to(BASE_DIR)}")

app = Flask(
    __name__,
    static_folder=str(STATIC_DIR),
    static_url_path="/static",
    template_folder=str(TEMPLATE_DIR),
)
CORS(app)

# ------------------------------------------------------------------ imports
from backend import project_manager as pm
from backend import dataset_manager as dm
from backend import annotation_manager as am
from backend import export_manager as exm
from backend import model_manager as mm
from backend import video_manager as vm
from backend import tracking_manager as tm
from backend import version_manager as vman
from backend import training_manager as tman
from backend import eval_manager as eman
from backend import quality_manager as qman
from backend import advanced_stats as asman
from backend import coco_export as coco
from backend import voc_export as voc
from backend import tag_manager as tagm
from backend import inference_server as inf

# =====================================================================
# FRONTEND
# =====================================================================
@app.route("/")
def index():
    return render_template("index.html")


@app.get("/_diag")
def _diag():
    """Diagnostic: list every static file Flask can see."""
    def tree(p: Path, depth=3):
        out = []
        if not p.exists():
            return ["<missing>"]
        for f in sorted(p.rglob("*")):
            rel = f.relative_to(p)
            if len(rel.parts) <= depth:
                out.append(str(rel) + ("/" if f.is_dir() else ""))
        return out
    return jsonify({
        "cwd": os.getcwd(),
        "base_dir": str(BASE_DIR),
        "static_dir": str(STATIC_DIR),
        "static_exists": STATIC_DIR.exists(),
        "templates_exists": TEMPLATE_DIR.exists(),
        "static_files": tree(STATIC_DIR),
        "template_files": tree(TEMPLATE_DIR),
    })


@app.get("/camera_status")
def camera_status():
    """Compatibility response for clients that poll an optional camera service."""
    return jsonify({
        "available": False,
        "connected": False,
        "running": False,
        "message": "No camera service is configured",
    })


# =====================================================================
# PROJECTS
# =====================================================================
@app.get("/api/projects")
def api_list_projects():
    return jsonify(pm.list_projects())


@app.post("/api/projects")
def api_create_project():
    body = request.get_json(force=True) or {}
    name = (body.get("name") or "").strip()
    desc = body.get("description", "")
    if not name:
        return jsonify({"error": "name required"}), 400
    try:
        meta = pm.create_project(name, desc)
        return jsonify(meta), 201
    except FileExistsError as e:
        return jsonify({"error": str(e)}), 409
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


@app.get("/api/projects/<name>")
def api_get_project(name):
    try:
        return jsonify(pm.load_project(name))
    except FileNotFoundError:
        return jsonify({"error": "not found"}), 404


@app.delete("/api/projects/<name>")
def api_delete_project(name):
    pm.delete_project(name)
    return jsonify({"ok": True})


# =====================================================================
# CLASSES
# =====================================================================
@app.get("/api/projects/<name>/classes")
def api_classes(name):
    return jsonify(pm.load_classes(name))


@app.put("/api/projects/<name>/classes")
def api_save_classes(name):
    body = request.get_json(force=True)
    if not isinstance(body, list):
        return jsonify({"error": "expected list"}), 400
    try:
        pm.save_classes(name, body)
        return jsonify(pm.load_classes(name))
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


@app.get("/api/projects/<name>/tags")
def api_tags(name):
    return jsonify(tagm.list_all_tags(name))


# =====================================================================
# IMAGES / DATASET
# =====================================================================
@app.get("/api/projects/<name>/images")
def api_list_images(name):
    q = request.args.get("q", "")
    only_unannotated = request.args.get("unannotated") == "1"
    reviewed = request.args.get("reviewed")
    reviewed = int(reviewed) if reviewed in ("0", "1") else None
    status = request.args.get("annotation_status")
    dataset_split = request.args.get("split")
    return jsonify(dm.list_images(name, q, only_unannotated, reviewed,
                                  status, dataset_split))


@app.post("/api/projects/<name>/import")
def api_import(name):
    # 1) file upload (multipart)
    if "files" in request.files:
        files = request.files.getlist("files")
        tmp_dir = Path(os.environ.get("TEMP", "/tmp")) / "vertex_upload"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        saved = []
        for f in files:
            if not f.filename:
                continue
            dst = tmp_dir / f.filename
            f.save(dst)
            saved.append(str(dst))
        return jsonify(dm.import_files(name, saved))

    # 2) JSON body: {zip: "path"} or {paths: [...]}
    body = request.get_json(force=True) or {}
    if "zip" in body:
        return jsonify(dm.import_zip(name, body["zip"]))
    paths = body.get("paths", [])
    files: list[str] = []
    for p in paths:
        p = Path(p)
        if p.is_dir():
            for f in p.rglob("*"):
                if f.is_file():
                    files.append(str(f))
        elif p.is_file():
            files.append(str(p))
    return jsonify(dm.import_files(name, files))


@app.get("/api/projects/<name>/image-file/<path:filename>")
def api_image_file(name, filename):
    p = dm.get_image_path(name, filename)
    if not p.exists():
        abort(404)
    return send_file(p)


@app.get("/api/projects/<name>/thumb/<path:filename>")
def api_thumb(name, filename):
    p = dm.get_thumb_path(name, filename)
    if not p.exists():
        src = dm.get_image_path(name, filename)
        if src.exists():
            try:
                dm._make_thumb(src, p)
            except Exception:
                pass
    if not p.exists():
        src = dm.get_image_path(name, filename)
        if src.exists():
            return send_file(src)
        abort(404)
    return send_file(p)


@app.delete("/api/projects/<name>/images")
def api_delete_images(name):
    body = request.get_json(force=True) or {}
    n = dm.delete_images(name, body.get("files", []))
    return jsonify({"deleted": n})


@app.post("/api/projects/<name>/review")
def api_review(name):
    body = request.get_json(force=True)
    dm.set_reviewed(name, body["filename"], bool(body["reviewed"]))
    return jsonify({"ok": True})


@app.post("/api/projects/<name>/dataset-split")
def api_set_dataset_split(name):
    body = request.get_json(force=True) or {}
    try:
        dm.set_dataset_split(name, body["filename"], body.get("split"))
        return jsonify({"ok": True, "split": body.get("split")})
    except (KeyError, ValueError, FileNotFoundError) as e:
        return jsonify({"error": str(e)}), 400


@app.get("/api/projects/<name>/stats")
def api_stats(name):
    return jsonify(dm.stats(name))


# =====================================================================
# ANNOTATIONS
# =====================================================================
@app.get("/api/projects/<name>/annotations/<path:filename>")
def api_get_anns(name, filename):
    return jsonify(am.sync_from_labels(name, filename))


@app.put("/api/projects/<name>/annotations/<path:filename>")
def api_save_anns(name, filename):
    body = request.get_json(force=True)
    am.save_annotations(name, filename, body)
    return jsonify({"ok": True, "count": len(body)})


# =====================================================================
# EXPORT (live dataset)
# =====================================================================
@app.post("/api/projects/<name>/export/yolo")
def api_export_yolo(name):
    body = request.get_json(force=True) or {}
    try:
        path = exm.export_yolo(
            name,
            split=bool(body.get("split", False)),
            ratios=tuple(body.get("ratios", [0.7, 0.2, 0.1])),
            seed=int(body.get("seed", 42)),
            annotated_only=bool(body.get("annotated_only", False)),
        )
        return send_file(path, as_attachment=True, download_name=Path(path).name)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


@app.post("/api/projects/<name>/export/csv")
def api_export_csv(name):
    path = exm.export_csv(name)
    return send_file(path, as_attachment=True, download_name=Path(path).name)


@app.post("/api/projects/<name>/export/coco")
def api_export_coco(name):
    body = request.get_json(silent=True) or {}
    try:
        path = coco.export_coco(name, annotated_only=bool(body.get("annotated_only", False)))
        return send_file(path, as_attachment=True, download_name=Path(path).name)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


@app.post("/api/projects/<name>/export/voc")
def api_export_voc(name):
    body = request.get_json(silent=True) or {}
    try:
        path = voc.export_voc_zip(name, annotated_only=bool(body.get("annotated_only", False)))
        return send_file(path, as_attachment=True, download_name=Path(path).name)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


# =====================================================================
# AI AUTO-ANNOTATION
# =====================================================================
@app.get("/api/device")
def api_device():
    return jsonify(mm.device_info())


@app.get("/api/models")
def api_models():
    return jsonify(mm.list_models())


@app.post("/api/models/warm")
def api_warm_model():
    body = request.get_json(force=True) or {}
    try:
        return jsonify(mm.warm_model(body["model_path"]))
    except Exception as e:
        app.logger.exception("Could not warm model")
        return jsonify({"error": str(e)}), 500


@app.post("/api/projects/<name>/autolabel")
def api_autolabel(name):
    body = request.get_json(force=True)
    mode = body.get("mode", "current")
    model_path = body["model_path"]
    conf = float(body.get("conf", 0.25))
    iou = float(body.get("iou", 0.45))
    if mode == "current":
        anns = mm.autolabel_image(
            name, body["filename"], model_path,
            conf, iou, body.get("class_ids"), body.get("device"),
            segmentation=bool(body.get("segmentation", False)),
            sam_class_id=int(body.get("class_id", 0))
        )
        existing = am.get_annotations(name, body["filename"])
        merged = existing + anns
        if not body.get("preview", False):
            am.save_annotations(name, body["filename"], merged)
        return jsonify({
            "added": len(anns), "annotations": merged,
            "new_annotations": anns, "preview": bool(body.get("preview", False))
        })
    else:
        result = mm.autolabel_dataset(
            name, model_path, conf, iou,
            overwrite=bool(body.get("overwrite", False))
        )
        return jsonify(result)


@app.post("/api/projects/<name>/smart-select")
def api_smart_select(name):
    body = request.get_json(force=True) or {}
    try:
        box = body.get("box")
        anns = mm.smart_select_image(
            name, body["filename"], body["model_path"],
            float(body["x"]) if "x" in body else None,
            float(body["y"]) if "y" in body else None,
            int(body.get("class_id", 0)), body.get("device"), box
        )
        existing = am.get_annotations(name, body["filename"])
        return jsonify({"added": len(anns), "new_annotations": anns,
                        "annotations": existing + anns})
    except Exception as e:
        app.logger.exception("Smart selection failed")
        return jsonify({"error": str(e)}), 500


# =====================================================================
# VIDEO
# =====================================================================
@app.post("/api/projects/<name>/video/extract")
def api_video_extract(name):
    body = request.get_json(force=True)
    n = vm.extract_frames(name, body["video_path"],
                          float(body.get("fps", 1.0)))
    return jsonify({"frames": n})


@app.post("/api/projects/<name>/video/info")
def api_video_info(name):
    body = request.get_json(force=True)
    return jsonify(vm.video_info(body["video_path"]))


# =====================================================================
# TRACKING
# =====================================================================
@app.post("/api/projects/<name>/track")
def api_track(name):
    body = request.get_json(force=True)
    return jsonify(tm.track_video(
        name, body["frames"], body["model_path"],
        body.get("tracker", "bytetrack.yaml"),
        float(body.get("conf", 0.3)),
        float(body.get("iou", 0.5)),
    ))


# =====================================================================
# VERSIONS
# =====================================================================
@app.get("/api/projects/<name>/versions")
def api_versions_list(name):
    return jsonify(vman.list_versions(name))


@app.post("/api/projects/<name>/versions")
def api_versions_create(name):
    body = request.get_json(force=True) or {}
    note = body.get("note", "")
    try:
        return jsonify(vman.create_version(
            name, note, body.get("split"), body.get("preprocessing"),
            body.get("augmentations")
        )), 201
    except FileExistsError as e:
        return jsonify({"error": str(e)}), 409


@app.get("/api/projects/<name>/versions/<int:vid>")
def api_versions_get(name, vid):
    try:
        return jsonify(vman.get_version(name, vid))
    except FileNotFoundError:
        return jsonify({"error": "not found"}), 404


@app.delete("/api/projects/<name>/versions/<int:vid>")
def api_versions_delete(name, vid):
    vman.delete_version(name, vid)
    return jsonify({"ok": True})


@app.post("/api/projects/<name>/versions/<int:vid>/download")
def api_versions_download(name, vid):
    try:
        fmt = request.args.get("format", "folder")
        path = (vman.export_version_yolo(name, vid, split=True)
                if fmt == "yolo" else vman.export_version_zip(name, vid))
        if request.args.get("download") == "1":
            return send_file(path, as_attachment=True, download_name=Path(path).name)
        return jsonify({"zip": path})
    except FileNotFoundError:
        return jsonify({"error": "version not found"}), 404


@app.get("/api/projects/<name>/versions/<int:vid>/download")
def api_versions_download_browser(name, vid):
    """Build and send a version archive as a real browser download."""
    fmt = request.args.get("format", "folder")
    try:
        if fmt == "yolo":
            path = vman.export_version_yolo(name, vid, split=True)
        else:
            path = vman.export_version_zip(name, vid)
        return send_file(path, as_attachment=True, download_name=Path(path).name)
    except FileNotFoundError:
        return jsonify({"error": "version not found"}), 404


@app.post("/api/projects/<name>/versions/<int:vid>/export/yolo")
def api_versions_export_yolo(name, vid):
    body = request.get_json(force=True) or {}
    try:
        path = vman.export_version_yolo(
            name, vid,
            split=bool(body.get("split", True)),
            ratios=tuple(body.get("ratios", [0.7, 0.2, 0.1])),
            seed=int(body.get("seed", 42)),
        )
        return jsonify({"zip": path})
    except FileNotFoundError:
        return jsonify({"error": "version not found"}), 404


# =====================================================================
# TRAINING
# =====================================================================
@app.post("/api/projects/<name>/train")
def api_train(name):
    body = request.get_json(force=True)
    try:
        job = tman.start_training(
            project=name,
            version_id=int(body["version_id"]),
            base_model=body.get("base_model", "yolo11n.pt"),
            epochs=int(body.get("epochs", 100)),
            imgsz=int(body.get("imgsz", 640)),
            batch=int(body.get("batch", 16)),
            device=body.get("device"),
            split=bool(body.get("split", True)),
        )
        return jsonify(job), 202
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.get("/api/jobs")
def api_jobs():
    return jsonify(tman.list_jobs())


@app.get("/api/jobs/<job_id>")
def api_job_status(job_id):
    try:
        return jsonify(tman.job_status(job_id))
    except KeyError:
        return jsonify({"error": "not found"}), 404


# =====================================================================
# EVALUATION
# =====================================================================
@app.post("/api/projects/<name>/eval")
def api_eval(name):
    body = request.get_json(force=True)
    try:
        report = eman.evaluate(
            project=name,
            version_id=int(body["version_id"]),
            model_path=body["model_path"],
            split=body.get("split", "val"),
            imgsz=int(body.get("imgsz", 640)),
            conf=float(body.get("conf", 0.001)),
            iou=float(body.get("iou", 0.6)),
        )
        return jsonify(report)
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# =====================================================================
# QUALITY + ADVANCED STATS
# =====================================================================
@app.get("/api/projects/<name>/quality")
def api_quality(name):
    return jsonify(qman.run_checks(name))


@app.get("/api/projects/<name>/advanced-stats")
def api_advanced_stats(name):
    return jsonify(asman.compute(name))


# =====================================================================
# TAGS
# =====================================================================
@app.get("/api/projects/<name>/tags")
def api_tags_all(name):
    return jsonify(tagm.list_all_tags(name))


@app.get("/api/projects/<name>/tags/<path:filename>")
def api_tags_for_image(name, filename):
    return jsonify({"tags": tagm.get_tags(name, filename)})


@app.post("/api/projects/<name>/tags/<path:filename>")
def api_tags_add(name, filename):
    body = request.get_json(force=True)
    tagm.add_tag(name, filename, body["tag"])
    return jsonify({"tags": tagm.get_tags(name, filename)})


@app.delete("/api/projects/<name>/tags/<path:filename>")
def api_tags_remove(name, filename):
    body = request.get_json(force=True)
    tagm.remove_tag(name, filename, body["tag"])
    return jsonify({"tags": tagm.get_tags(name, filename)})


@app.get("/api/projects/<name>/tags/<tag>/images")
def api_images_by_tag(name, tag):
    return jsonify(tagm.list_images_with_tag(name, tag))


# =====================================================================
# LOCAL INFERENCE SERVER CONTROL
# =====================================================================
@app.post("/api/inference/load")
def api_inference_load():
    body = request.get_json(force=True)
    try:
        return jsonify(inf.load(body["model_path"]))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.get("/api/inference/status")
def api_inference_status():
    return jsonify({
        "loaded": inf._STATE["model"] is not None,
        "path": inf._STATE["path"],
        "names": inf._STATE["names"],
        "url": "http://127.0.0.1:5001",
    })


# =====================================================================
# LAUNCH
# =====================================================================
def _open_browser():
    time.sleep(1.0)
    webbrowser.open("http://localhost:5000")


if __name__ == "__main__":
    # Boot the inference micro-server on 127.0.0.1:5001
    try:
        inf.serve_in_thread(port=5001)
        print("[startup] inference server → http://127.0.0.1:5001")
    except Exception as e:
        print(f"[startup] inference server failed to start: {e}")

    threading.Thread(target=_open_browser, daemon=True).start()
    app.run(host="127.0.0.1", port=5000, debug=False, threaded=True)
