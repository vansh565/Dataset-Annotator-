/* Vertex · Export page */
(function () {
  "use strict";
  window.Pages = window.Pages || {};

  window.Pages.export = function (host) {
    const U = window.UI;
    const state = window.__state;

    host.innerHTML = `
      <div class="page">
        <div class="page-head">
          <h1 class="page-title">Export</h1>
          <span class="page-sub">Download dataset files to your computer</span>
        </div>
        <div class="page-body">
          <div class="card" style="padding:14px;margin-bottom:16px">
            <label class="row" style="gap:8px"><input type="checkbox" id="exp-annotated" checked>
              Export annotated images only</label>
            <div class="muted" style="margin:6px 0 0 25px">YOLO, COCO, and Pascal VOC will include only images with saved annotations. CSV always contains labeled objects.</div>
          </div>
          <div class="card" style="padding:18px;max-width:720px">
            <label class="fld" for="exp-format">Image and Annotation Format
              <select id="exp-format" class="input">
                <optgroup label="TXT">
                  <option value="yolo">YOLO Detection · ZIP</option>
                  <option value="yolo-split">YOLO Detection · Train / Validation / Test ZIP</option>
                </optgroup>
                <optgroup label="JSON"><option value="coco">COCO Object Detection · JSON</option></optgroup>
                <optgroup label="XML"><option value="voc">Pascal VOC · Images and XML ZIP</option></optgroup>
                <optgroup label="CSV"><option value="csv">Annotation Table · CSV</option></optgroup>
              </select>
            </label>
            <div class="muted" id="exp-format-help" style="margin:8px 0 14px">Images, labels, class names, and data.yaml.</div>
            <button class="btn primary" id="exp-download">Download format</button>
          </div>
          <div id="exp-status" class="muted" style="margin-top:14px" aria-live="polite"></div>
        </div>
      </div>`;

    const status = document.getElementById("exp-status");
    const formatSelect = document.getElementById("exp-format");
    const formatHelp = document.getElementById("exp-format-help");
    const helpText = {
      "yolo": "Images, labels, class names, and data.yaml.",
      "yolo-split": "Creates train, validation, and test folders. Saved per-image split assignments are preserved.",
      "coco": "COCO JSON with object boxes, rotated-box bounds, and polygon annotations.",
      "voc": "ZIP with source images, box XML annotations, and ImageSets/Main/trainval.txt.",
      "csv": "One row per saved box, polygon, or oriented-box annotation."
    };
    formatSelect.onchange = function () { formatHelp.textContent = helpText[formatSelect.value]; };
    document.getElementById("exp-download").onclick = async function () {
        const button = document.getElementById("exp-download");
        if (!state.project) return U.toast("Select a project", "warn");
        const kind = formatSelect.value;
        const format = kind === "yolo-split" ? "yolo" : kind;
        const options = {
          annotated_only: document.getElementById("exp-annotated").checked,
          split: kind === "yolo-split",
          ratios: [0.7, 0.2, 0.1],
          seed: 42
        };
        const label = button.textContent;
        button.disabled = true;
        button.textContent = "Preparing…";
        status.textContent = "Building " + format.toUpperCase() + " export…";
        try {
          const filename = await window.API.downloadExport(state.project, format, options);
          status.textContent = filename + " downloaded. Check your browser's Downloads folder.";
          U.toast("Downloaded " + filename, "ok", 5000);
        } catch (e) {
          status.textContent = "Export failed: " + e.message;
          U.toast("Export failed: " + e.message, "err");
        } finally {
          button.disabled = false;
          button.textContent = label;
        }
    };
  };
})();
