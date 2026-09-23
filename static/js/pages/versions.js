/* Vertex · Dataset versions page */
(function () {
  "use strict";
  window.Pages = window.Pages || {};

  window.Pages.versions = function (host) {
    const U = window.UI;
    const state = window.__state;

    host.innerHTML = `
      <div class="page version-page">
        <div class="page-head">
          <h1 class="page-title">Versions</h1>
          <span class="page-sub">Build a reproducible local dataset snapshot</span>
        </div>
        <div class="version-layout">
          <aside class="version-rail">
            <div class="version-rail-title">Versions <span id="v-count">0</span></div>
            <div id="v-history"><div class="muted">No versions created yet.</div></div>
          </aside>
          <section class="version-builder">
            <div class="version-callout">
              <div><b>Ready for training?</b><span>Creates a split from images that have saved annotations. Unannotated images are excluded.</span></div>
              <button class="btn primary" id="v-create-top">Create version</button>
            </div>
            <div id="v-version-detail" class="version-detail hidden"></div>
            <div class="version-intro">
              <h2>Create New Version</h2>
              <p>Prepare your images and data by compiling them into a version.</p>
              <label class="fld">Version name
                <input id="v-name" class="input" placeholder="2026-09-22 18:30" />
              </label>
            </div>
            <div class="version-step done"><span class="step-mark">✓</span><div class="step-content">
              <div class="step-title">Annotated Source Images <button class="link-btn" id="v-edit-source">Refresh</button></div>
              <div class="step-detail"><span>Images: <b id="v-images">0</b></span><span>Classes: <b id="v-classes">0</b></span><span>Labels: <b id="v-labels">0</b></span></div>
              <div id="v-source-strip" class="source-strip"></div>
            </div></div>
            <div class="version-step done"><span class="step-mark">✓</span><div class="step-content">
              <div class="step-title">Train / Test Split</div>
              <div class="split-grid">
                <label class="fld">Training <input id="v-train" class="input" type="number" min="0" max="100" value="70" /></label>
                <label class="fld">Validation <input id="v-val" class="input" type="number" min="0" max="100" value="20" /></label>
                <label class="fld">Testing <input id="v-test" class="input" type="number" min="0" max="100" value="10" /></label>
              </div>
              <div class="split-total" id="v-total">Total: 100%</div>
            </div></div>
            <div class="version-step"><span class="step-number">3</span><div class="step-content">
              <div class="step-title">Preprocessing <button class="link-btn" id="v-add-prep">+ Add</button></div>
              <p class="muted">Optional local transforms applied during export. Originals are never modified.</p>
              <div id="v-preprocessing" class="prep-list">
                <div class="prep-row"><b>Auto-orient</b><span class="muted">Normalize image orientation</span><button class="link-btn" data-remove-prep>×</button></div>
                <div class="prep-row" data-prep="resize"><b>Resize</b><span class="muted">Stretch to</span><input class="input prep-size" type="number" min="32" value="224" /><span class="muted">×</span><input class="input prep-size" type="number" min="32" value="224" /><button class="link-btn" data-remove-prep>×</button></div>
              </div>
            </div></div>
            <div class="version-step"><span class="step-number">4</span><div class="step-content">
              <div class="step-title">Augmentation <button class="link-btn" id="v-add-aug">+ Add augmentation</button></div>
              <p class="muted">Optional training-only transforms. Original images stay unchanged.</p>
              <div id="v-augmentations" class="prep-list"><div class="prep-row"><b>No augmentations</b><span class="muted">Add one to create extra training examples</span></div></div>
            </div></div>
            <div class="version-footer"><span class="muted" id="v-status">Snapshot images, labels, and classes locally.</span><button class="btn primary" id="v-create">Create version</button></div>
          </section>
        </div>
      </div>`;

    const vTrain = document.getElementById("v-train");
    const vVal = document.getElementById("v-val");
    const vTest = document.getElementById("v-test");
    const name = document.getElementById("v-name");
    name.value = new Date().toISOString().slice(0, 16).replace("T", " ");

    function updateTotal() {
      const total = [vTrain, vVal, vTest].reduce(function (sum, input) {
        return sum + (Number(input.value) || 0);
      }, 0);
      const totalEl = document.getElementById("v-total");
      totalEl.textContent = "Total: " + total + "%";
      totalEl.classList.toggle("invalid", total !== 100);
      return total === 100;
    }
    [vTrain, vVal, vTest].forEach(function (input) { input.oninput = updateTotal; });
    function prepData() {
      return Array.from(document.querySelectorAll("#v-preprocessing .prep-row")).map(function (row) {
        const item = { name: row.querySelector("b").textContent };
        if (row.dataset.prep === "resize") {
          const sizes = row.querySelectorAll(".prep-size");
          item.mode = "stretch";
          item.width = Number(sizes[0].value) || 224;
          item.height = Number(sizes[1].value) || 224;
        }
        return item;
      });
    }
    function openDownloadDialog(version) {
      const modal = document.createElement("div");
      modal.className = "modal";
      modal.innerHTML = '<div class="modal-box download-modal"><div class="download-title"><span>⇩</span><h3>Download</h3><button class="link-btn" data-close>×</button></div>' +
        '<label class="fld">Image and annotation format<select class="input" id="download-format"><option value="yolo" selected>YOLO Dataset (.zip)</option><option value="folder">Folder Structure (.zip)</option></select></label>' +
        '<div class="download-options"><b>Download options</b><label><input type="radio" checked> Download ZIP to computer</label><span class="muted">Downloads all images, annotations, and classes.</span></div>' +
        '<div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" data-confirm>Continue</button></div></div>';
      document.body.appendChild(modal);
      function close() { modal.remove(); }
      modal.querySelectorAll("[data-close]").forEach(function (button) { button.onclick = close; });
      modal.onclick = function (event) { if (event.target === modal) close(); };
      modal.querySelector("[data-confirm]").onclick = function () {
        const format = modal.querySelector("#download-format").value;
        const href = "/api/projects/" + encodeURIComponent(state.project) +
          "/versions/" + version.id + "/download?download=1&format=" + format;
        fetch(href, { method: "POST" }).then(function (response) {
          if (!response.ok) throw new Error("Download failed (" + response.status + ")");
          const contentType = response.headers.get("content-type") || "";
          if (contentType.indexOf("zip") === -1 && contentType.indexOf("octet-stream") === -1) {
            throw new Error("Server did not return a ZIP file");
          }
          return response.blob();
        }).then(function (blob) {
          const link = document.createElement("a");
          link.href = URL.createObjectURL(blob);
          link.download = state.project + "_" + version.name.replace(/[^a-z0-9_-]+/gi, "_") + ".zip";
          document.body.appendChild(link);
          link.click();
          URL.revokeObjectURL(link.href);
          link.remove();
          close();
          U.toast("Download started", "ok");
        }).catch(function (error) { U.toast(error.message, "err"); });
      };
    }
    function augData() {
      return Array.from(document.querySelectorAll("#v-augmentations .prep-row[data-aug]")).map(function (row) {
        return { name: row.dataset.aug };
      });
    }
    document.getElementById("v-preprocessing").onclick = function (event) {
      if (event.target.hasAttribute("data-remove-prep")) event.target.parentElement.remove();
    };
    document.getElementById("v-add-prep").onclick = function () {
      const row = document.createElement("div");
      row.className = "prep-row";
      row.innerHTML = '<b>Letterbox</b><span class="muted">Pad to preserve aspect ratio</span><button class="link-btn" data-remove-prep>×</button>';
      document.getElementById("v-preprocessing").appendChild(row);
    };
    document.getElementById("v-add-aug").onclick = function () {
      const list = document.getElementById("v-augmentations");
      const empty = list.querySelector(".prep-row:not([data-aug])");
      if (empty) empty.remove();
      const row = document.createElement("div");
      row.className = "prep-row";
      row.dataset.aug = "Horizontal flip";
      row.innerHTML = '<b>Horizontal flip</b><span class="muted">Mirror training images</span><button class="link-btn" data-remove-aug>×</button>';
      list.appendChild(row);
    };
    document.getElementById("v-augmentations").onclick = function (event) {
      if (event.target.hasAttribute("data-remove-aug")) event.target.parentElement.remove();
    };

    async function createVersion() {
      if (!state.project) return U.toast("Select a project first", "warn");
      if (!updateTotal()) return U.toast("Split percentages must total 100%", "warn");
      const button = document.getElementById("v-create");
      button.disabled = true;
      document.getElementById("v-status").textContent = "Creating local version…";
      try {
        const sourceImages = await window.API.listImages(state.project);
        const annotatedCount = sourceImages.filter(function (image) {
          return (image.ann_count || 0) > 0;
        }).length;
        if (!annotatedCount) throw new Error("There are no annotated images to include.");
        const v = await window.API.createVersion(state.project, name.value.trim(), {
          split: { train: Number(vTrain.value) / 100, val: Number(vVal.value) / 100, test: Number(vTest.value) / 100 },
          preprocessing: prepData(), augmentations: augData()
        });
        // The local Flask server runs without auto-reload. Reject a snapshot
        // from an older server process if it included unannotated images.
        if (Number(v.images) !== annotatedCount) {
          try { await window.API.deleteVersion(state.project, v.id); } catch (ignored) { /* report the mismatch below */ }
          throw new Error("The local server returned " + v.images + " images, but only " + annotatedCount + " are annotated. Restart the app server, then create the version again.");
        }
        U.toast(v.name + " created", "ok");
        document.getElementById("v-status").textContent = v.name + " created and ready for export.";
        refresh();
      } catch (e) {
        document.getElementById("v-status").textContent = "Could not create version.";
        U.toast("Create version failed: " + e.message, "err");
      } finally { button.disabled = false; }
    }
    document.getElementById("v-create").onclick = createVersion;
    document.getElementById("v-create-top").onclick = createVersion;
    document.getElementById("v-edit-source").onclick = refresh;

    async function refresh() {
      if (!state.project) return;
      try {
        const images = await window.API.listImages(state.project);
        const annotatedImages = images.filter(function (image) { return (image.ann_count || 0) > 0; });
        state.images = images;
        state.classes = await window.API.getClasses(state.project);
        const versions = await window.API.listVersions(state.project);
        document.getElementById("v-images").textContent = annotatedImages.length;
        document.getElementById("v-classes").textContent = state.classes.length;
        document.getElementById("v-labels").textContent = annotatedImages.reduce(function (sum, image) {
          return sum + (image.ann_count || 0);
        }, 0);
        document.getElementById("v-source-strip").innerHTML = annotatedImages.slice(0, 12).map(function (image) {
          return '<img class="version-thumb" src="' + window.API.thumbUrl(state.project, image.filename) + '" title="' + U.escapeHtml(image.filename) + '">';
        }).join("");
        document.getElementById("v-count").textContent = versions.length;
        const history = document.getElementById("v-history");
        history.innerHTML = versions.length ? versions.slice().reverse().map(function (version) {
          return '<div class="version-history-item" data-version-select="' + version.id + '"><b>' + U.escapeHtml(version.name) + '</b><span>' +
            version.images + ' images · ' + version.labels + ' labels</span>' +
            '<div class="version-history-actions"><button class="link-btn" data-version-zip="' + version.id + '">Download dataset</button>' +
            '<button class="link-btn" data-version-yolo="' + version.id + '">YOLO export</button></div></div>';
        }).join("") : '<div class="muted">No versions created yet.</div>';
        history.querySelectorAll("[data-version-select]").forEach(function (item) {
          item.onclick = function (event) {
            if (event.target.closest("button")) return;
            const version = versions.find(function (entry) { return String(entry.id) === item.dataset.versionSelect; });
            if (!version) return;
            const split = version.split || { train: 0.7, val: 0.2, test: 0.1 };
            const prep = (version.preprocessing || []).map(function (entry) { return entry.name; }).join(", ") || "None";
            const aug = (version.augmentations || []).map(function (entry) { return entry.name; }).join(", ") || "None";
            const detail = document.getElementById("v-version-detail");
            detail.classList.remove("hidden");
            const versionFilenames = new Set(version.image_filenames || []);
            const versionImages = version.image_filenames
              ? (state.images || []).filter(function (image) { return versionFilenames.has(image.filename); })
              : annotatedImages.slice(0, version.images);
            detail.innerHTML = '<div class="detail-header"><div><span class="eyebrow">Dataset version</span><h3>' + U.escapeHtml(version.name) + '</h3>' +
              '<p class="muted">Local snapshot · ' + version.images + ' images · ' + version.labels + ' labels</p></div>' +
              '<div class="detail-actions"><button class="btn mini" id="v-detail-download">Download Dataset</button><button class="btn mini danger" id="v-detail-delete">Delete</button></div></div>' +
              '<div class="model-empty"><b>This version does not have a model.</b><span class="muted">Train a local model from this dataset or export it for another workflow.</span><button class="btn primary" id="v-detail-train">Train Model</button></div>' +
              '<div class="detail-images"><div class="detail-section-label">' + version.images + ' Annotated Images</div><div class="source-strip">' + versionImages.slice(0, 12).map(function (image) {
                return '<img class="version-thumb" src="' + window.API.thumbUrl(state.project, image.filename) + '" title="' + U.escapeHtml(image.filename) + '">';
              }).join("") + '</div></div>' +
              '<div class="detail-section-label">Dataset Split</div><div class="detail-split"><div class="split-card train"><span>TRAIN SET</span><b>' + (version.split_counts ? version.split_counts.train : Math.floor(split.train * version.images)) + ' images</b><i>' + Math.round(split.train * 100) + '%</i></div>' +
              '<div class="split-card valid"><span>VALID SET</span><b>' + (version.split_counts ? version.split_counts.val : Math.floor(split.val * version.images)) + ' images</b><i>' + Math.round(split.val * 100) + '%</i></div>' +
              '<div class="split-card test"><span>TEST SET</span><b>' + (version.split_counts ? version.split_counts.test : version.images - Math.floor(split.train * version.images) - Math.floor(split.val * version.images)) + ' images</b><i>' + Math.round(split.test * 100) + '%</i></div></div>' +
              '<div class="detail-summary"><div><span>Preprocessing</span><b>' + U.escapeHtml(prep) + '</b></div><div><span>Augmentations</span><b>' + U.escapeHtml(aug) + '</b></div></div>';
            document.getElementById("v-detail-download").onclick = async function () {
              openDownloadDialog(version);
            };
            document.getElementById("v-detail-delete").onclick = async function () {
              if (!confirm("Delete this dataset version?")) return;
              await window.API.deleteVersion(state.project, version.id); refresh(); detail.classList.add("hidden");
            };
            document.getElementById("v-detail-train").onclick = function () {
              U.toast("Training setup is available from the Train page", "ok"); window.__nav("train");
            };
          };
        });
        history.querySelectorAll("[data-version-zip]").forEach(function (button) {
          button.onclick = async function () {
            const version = versions.find(function (entry) { return String(entry.id) === button.dataset.versionZip; });
            if (version) openDownloadDialog(version);
          };
        });
        history.querySelectorAll("[data-version-yolo]").forEach(function (button) {
          button.onclick = async function () {
            try {
              const result = await window.API.exportVersionYolo(state.project, button.dataset.versionYolo, true);
              U.toast("YOLO ZIP created: " + result.zip, "ok", 5000);
            } catch (e) { U.toast("Export failed: " + e.message, "err"); }
          };
        });
      } catch (e) { U.toast("Could not load version data: " + e.message, "err"); }
    }
    updateTotal();
    refresh();
  };
})();
