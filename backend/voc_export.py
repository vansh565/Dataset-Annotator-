"""Pascal VOC XML export."""
from __future__ import annotations
from pathlib import Path
import shutil
import time
import zipfile
import xml.etree.ElementTree as ET

from .project_manager import project_path, load_classes, BASE_DIR
from .annotation_manager import get_annotations

EXPORTS_DIR = BASE_DIR / "exports"


def export_voc(project: str, annotated_only: bool = False) -> str:
    p = project_path(project)
    classes = load_classes(project)
    names = {c["id"]: c["name"] for c in classes}
    out_dir = EXPORTS_DIR / f"{p.name}_voc_{int(time.time())}"
    annotations_by_file = {f.name: get_annotations(project, f.name)
                           for f in (p / "images").iterdir() if f.is_file()}
    if annotated_only:
        annotations_by_file = {name: anns for name, anns in annotations_by_file.items() if anns}
    if not annotations_by_file:
        raise ValueError("No images match the selected export options")
    image_dir = out_dir / "JPEGImages"
    annotation_dir = out_dir / "Annotations"
    image_dir.mkdir(parents=True, exist_ok=True)
    annotation_dir.mkdir(parents=True, exist_ok=True)
    split_dir = out_dir / "ImageSets" / "Main"
    split_dir.mkdir(parents=True, exist_ok=True)
    split_lines = []
    out_dir.mkdir(parents=True, exist_ok=True)

    from PIL import Image
    for f in sorted((p / "images").iterdir()):
        if not f.is_file() or f.name not in annotations_by_file: continue
        with Image.open(f) as im:
            w, h = im.size
        shutil.copy2(f, image_dir / f.name)
        split_lines.append(f.stem)
        root = ET.Element("annotation")
        ET.SubElement(root, "folder").text = p.name
        ET.SubElement(root, "filename").text = f.name
        src = ET.SubElement(root, "source"); ET.SubElement(src, "database").text = project
        size = ET.SubElement(root, "size")
        ET.SubElement(size, "width").text = str(w)
        ET.SubElement(size, "height").text = str(h)
        ET.SubElement(size, "depth").text = "3"
        ET.SubElement(root, "segmented").text = "0"
        for a in annotations_by_file[f.name]:
            if a["type"] != "box": continue
            obj = ET.SubElement(root, "object")
            ET.SubElement(obj, "name").text = names.get(a["class_id"], str(a["class_id"]))
            ET.SubElement(obj, "pose").text = "Unspecified"
            ET.SubElement(obj, "truncated").text = "0"
            ET.SubElement(obj, "difficult").text = "0"
            bnd = ET.SubElement(obj, "bndbox")
            ET.SubElement(bnd, "xmin").text = str(int(a["x"]*w))
            ET.SubElement(bnd, "ymin").text = str(int(a["y"]*h))
            ET.SubElement(bnd, "xmax").text = str(int((a["x"]+a["w"])*w))
            ET.SubElement(bnd, "ymax").text = str(int((a["y"]+a["h"])*h))
        tree = ET.ElementTree(root)
        ET.indent(tree, space="  ")
        tree.write(annotation_dir / (f.stem + ".xml"), encoding="utf-8", xml_declaration=True)
    (split_dir / "trainval.txt").write_text("\n".join(split_lines) + "\n", encoding="utf-8")
    zip_path = EXPORTS_DIR / (out_dir.name + ".zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for file in out_dir.rglob("*"):
            if file.is_file():
                archive.write(file, file.relative_to(out_dir))
    return str(out_dir)


def export_voc_zip(project: str, annotated_only: bool = False) -> str:
    out_dir = Path(export_voc(project, annotated_only))
    return str(EXPORTS_DIR / (out_dir.name + ".zip"))
