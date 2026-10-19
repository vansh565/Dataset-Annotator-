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
          <section class="card" style="padding:18px;max-width:900px;margin-top:18px">
            <label class="row" style="gap:8px;font-weight:700">
              <input type="checkbox" id="exp-classification-enabled"> Enable Image Classification Format
            </label>
            <p class="muted" style="margin:8px 0 14px 25px">Classification uses manually verified brand labels and the per-image Train/Validation/Test split. It never guesses labels from image content.</p>
            <div id="exp-classification-controls" class="hidden">
              <label class="fld" for="exp-classification-brands">Brand folders (one per line)
                <textarea id="exp-classification-brands" class="input" rows="5" placeholder="Hyundai&#10;Suzuki&#10;Tata&#10;Mahindra&#10;Kia"></textarea>
              </label>
              <button class="btn" id="exp-classification-save" type="button">Save brand folders</button>
              <p class="muted">Assign each image a verified brand and split on the Dataset page. Export downloads a ZIP to your browser’s Downloads folder; it never overwrites the source images.</p>
              <div id="exp-classification-readiness" class="card muted" style="padding:10px;margin:10px 0" aria-live="polite">Checking image assignments…</div>
              <label class="fld" for="exp-classification-name">Dataset name
                <input id="exp-classification-name" class="input" value="brand_dataset" maxlength="64">
              </label>
              <button class="btn primary" id="exp-classification-export" type="button">Export Classification Dataset</button>
              <div id="exp-classification-result" class="muted" style="margin-top:12px;white-space:pre-line" aria-live="polite"></div>
            </div>
          </section>
          <div id="exp-status" class="muted" style="margin-top:14px" aria-live="polite"></div>
        </div>
      </div>`;

    const status = document.getElementById("exp-status");
    const formatSelect = document.getElementById("exp-format");
    const formatHelp = document.getElementById("exp-format-help");
    const classificationToggle = document.getElementById("exp-classification-enabled");
    const classificationControls = document.getElementById("exp-classification-controls");
    const classificationBrands = document.getElementById("exp-classification-brands");
    const classificationResult = document.getElementById("exp-classification-result");
    // Keep the optional workflow immediately visible when opening Export.
    host.querySelector(".page-body").prepend(classificationControls.closest("section"));
    const helpText = {
      "yolo": "Images, labels, class names, and data.yaml.",
      "yolo-split": "Creates train, validation, and test folders. Saved per-image split assignments are preserved.",
      "coco": "COCO JSON with object boxes, rotated-box bounds, and polygon annotations.",
      "voc": "ZIP with source images, box XML annotations, and ImageSets/Main/trainval.txt.",
      "csv": "One row per saved box, polygon, or oriented-box annotation."
    };
    formatSelect.onchange = function () { formatHelp.textContent = helpText[formatSelect.value]; };

    function showClassificationResult(result) {
      const summary = result.summary || {};
      const lines = [result.filename + " downloaded. Check your browser’s Downloads folder.",
        "Exported " + (summary.total || 0) + " image(s). Counts per split and brand:"];
      ["train", "val", "test"].forEach(function (split) {
        const counts = (summary.counts || {})[split] || {};
        lines.push(split + ": " + Object.keys(counts).map(function (brand) {
          return brand + " " + counts[brand];
        }).join(" · "));
      });
      if ((summary.warnings || []).length) lines.push("Warnings: " + summary.warnings.join(" "));
      classificationResult.textContent = lines.join("\n");
    }

    async function refreshClassificationReadiness(config) {
      const readiness = document.getElementById("exp-classification-readiness");
      if (!state.project || !config.enabled) {
        readiness.textContent = "Enable this format to see assignment status.";
        return 0;
      }
      const images = await window.API.listImages(state.project);
      const brands = new Set(config.brands);
      const withBrand = images.filter(function (image) { return brands.has(image.classification_brand); }).length;
      const withSplit = images.filter(function (image) { return ["train", "val", "test"].includes(image.dataset_split); }).length;
      const ready = images.filter(function (image) {
        return brands.has(image.classification_brand) && ["train", "val", "test"].includes(image.dataset_split);
      }).length;
      readiness.textContent = ready + " of " + images.length + " images ready. Verified brand: " + withBrand + "; explicit split: " + withSplit + ". Choose a brand and Train/Validation/Test split for every image to export. Auto split images are skipped.";
      return ready;
    }

    async function saveClassificationSettings() {
      if (!state.project) throw new Error("Select a project first");
      const brands = classificationBrands.value.split(/\r?\n/).map(function (name) { return name.trim(); }).filter(Boolean);
      const config = await window.API.saveClassificationConfig(state.project, {
        enabled: classificationToggle.checked, brands: brands
      });
      classificationToggle.checked = config.enabled;
      classificationBrands.value = config.brands.join("\n");
      classificationControls.classList.toggle("hidden", !config.enabled);
      return config;
    }

    classificationToggle.onchange = async function () {
      try {
        const config = await saveClassificationSettings();
        await refreshClassificationReadiness(config);
        U.toast("Classification format " + (classificationToggle.checked ? "enabled" : "disabled"), "ok");
      }
      catch (e) { classificationToggle.checked = !classificationToggle.checked; U.toast("Could not update format: " + e.message, "err"); }
    };
    document.getElementById("exp-classification-save").onclick = async function () {
      try { await saveClassificationSettings(); U.toast("Brand folders saved", "ok"); }
      catch (e) { U.toast("Could not save brand folders: " + e.message, "err"); }
    };
    document.getElementById("exp-classification-export").onclick = async function () {
      const button = document.getElementById("exp-classification-export");
      try {
        if (!state.project) throw new Error("Select a project first");
        await saveClassificationSettings();
        const config = await window.API.getClassificationConfig(state.project);
        const ready = await refreshClassificationReadiness(config);
        if (!ready) throw new Error("No images have both a verified brand and an explicit split. Assign them on the Dataset page, then export again.");
        button.disabled = true;
        classificationResult.textContent = "Preparing classification ZIP download…";
        const result = await window.API.exportClassification(state.project, {
          dataset_name: document.getElementById("exp-classification-name").value.trim()
        });
        showClassificationResult(result);
      } catch (e) {
        classificationResult.textContent = "Export failed: " + e.message;
      } finally { button.disabled = false; }
    };
    if (state.project) {
      window.API.getClassificationConfig(state.project).then(function (config) {
        classificationToggle.checked = config.enabled;
        classificationBrands.value = config.brands.join("\n");
        classificationControls.classList.toggle("hidden", !config.enabled);
        return refreshClassificationReadiness(config);
      }).catch(function (e) { classificationResult.textContent = "Could not load classification settings: " + e.message; });
    }
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
