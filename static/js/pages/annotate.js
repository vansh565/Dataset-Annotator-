/* Vertex · Annotate page */
(function () {
  "use strict";
  window.Pages = window.Pages || {};

  function annotationBoard(host, state) {
    let active = "unannotated";
    host.innerHTML = `<div class="page annotation-board"><div class="page-head"><h1 class="page-title">Smart Annotation</h1><span class="page-sub">Review and label your dataset</span><div class="page-actions"><button class="btn" id="board-refresh">Refresh</button><button class="btn primary" id="board-open-dataset">Open Dataset</button></div></div><div class="grid" id="ann-stats" style="grid-template-columns:repeat(auto-fill,minmax(145px,1fr));margin:0 0 18px"></div><div id="ann-class-summary" class="card" style="padding:14px;margin-bottom:18px"></div><div class="board-tabs"><button class="tab active" data-queue="unannotated">Unannotated <span id="ann-pending-count"></span></button><button class="tab" data-queue="annotated">Annotated <span id="ann-done-count"></span></button></div><section class="card" style="padding:16px"><div class="job-images-head"><b id="ann-queue-title">Unannotated images</b><span class="muted" id="ann-queue-count"></span></div><div class="job-image-grid" id="job-image-grid"></div><div class="empty hidden" id="ann-queue-empty"><h3>Nothing here</h3><p>This section has no images yet.</p></div></section></div>`;
    async function load() {
      try {
        const results = await Promise.all([window.API.stats(state.project), window.API.listImages(state.project)]);
        const stats = results[0], images = results[1];
        const annotated = images.filter(function (image) { return (image.ann_count || 0) > 0; });
        const pending = images.filter(function (image) { return (image.ann_count || 0) === 0; });
        document.getElementById("ann-stats").innerHTML = [
          [stats.total_images || 0, "Total images"], [stats.annotated_images || 0, "Annotated images"],
          [stats.unannotated_images || 0, "Unannotated images"], [stats.total_annotations || 0, "Annotations"],
          [stats.total_classes || 0, "Classes"], [stats.reviewed_images || 0, "Reviewed"]
        ].map(function (item) { return '<div class="card" style="padding:14px"><b style="font-size:22px">' + item[0] + '</b><div class="muted">' + item[1] + '</div></div>'; }).join("");
        const classes = stats.per_class || [];
        document.getElementById("ann-class-summary").innerHTML = '<b>Annotations by class</b><div class="row" style="gap:16px;flex-wrap:wrap;margin-top:10px">' + (classes.length ? classes.map(function (item) { return '<span><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + (item.color || "var(--accent)") + '"></i> ' + window.UI.escapeHtml(item.name) + ': ' + item.count + '</span>'; }).join("") : '<span class="muted">No classes yet</span>') + '</div>';
        document.getElementById("ann-pending-count").textContent = "(" + pending.length + ")";
        document.getElementById("ann-done-count").textContent = "(" + annotated.length + ")";
        const list = active === "annotated" ? annotated : pending;
        document.getElementById("ann-queue-title").textContent = active === "annotated" ? "Annotated images" : "Unannotated images";
        document.getElementById("ann-queue-count").textContent = list.length + " images";
        const grid = document.getElementById("job-image-grid");
        grid.innerHTML = list.map(function (image) { return '<button class="job-image-card" data-image="' + encodeURIComponent(image.filename) + '"><img src="' + window.API.thumbUrl(state.project, image.filename) + '"><span>' + window.UI.escapeHtml(image.filename) + '</span><small>' + (image.ann_count || 0) + ' annotations</small></button>'; }).join("");
        grid.classList.toggle("hidden", !list.length);
        document.getElementById("ann-queue-empty").classList.toggle("hidden", !!list.length);
        grid.querySelectorAll("[data-image]").forEach(function (button) { button.onclick = function () { state.currentImage = decodeURIComponent(button.dataset.image); window.__nav("annotate"); }; });
      } catch (e) { window.UI.toast("Could not load annotation progress: " + e.message, "err"); }
    }
    host.querySelectorAll("[data-queue]").forEach(function (button) { button.onclick = function () { active = button.dataset.queue; host.querySelectorAll("[data-queue]").forEach(function (tab) { tab.classList.toggle("active", tab === button); }); load(); }; });
    document.getElementById("board-refresh").onclick = load;
    document.getElementById("board-open-dataset").onclick = function () { window.__nav("dataset"); };
    load();
  }

  async function annotationJobDetail(host, state) {
    host.innerHTML = `<div class="page annotation-job"><div class="page-head"><button class="btn mini" id="job-back">← Board</button><h1 class="page-title">${state.project || "Project"} · Annotation Job</h1><span class="page-sub">Progress and assignment</span></div><div class="job-layout"><aside class="job-sidebar"><h3>Progress</h3><div class="job-progress-line" id="detail-progress"></div><p id="detail-count" class="muted"></p><h3>Instructions</h3><p class="muted">Review each image and correct annotations before saving.</p><h3>Assignment</h3><p>Local annotator</p><h3>Timeline</h3><p class="muted">Job created locally for this project.</p></aside><main class="job-images"><div class="job-images-head"><b>Images</b><button class="btn mini" id="job-refresh-images">Refresh</button></div><div class="job-image-grid" id="job-image-grid"></div></main></div></div>`;
    document.getElementById("job-back").onclick = function () { annotationBoard(host, state); };
    async function loadImages() {
      const images = await window.API.listImages(state.project);
      const stats = await window.API.stats(state.project);
      const percent = Math.round((stats.annotated_images || 0) / Math.max(1, images.length) * 100);
      document.getElementById("detail-progress").style.width = percent + "%";
      document.getElementById("detail-count").textContent = images.length + " media items · " + (stats.annotated_images || 0) + " annotated";
      document.getElementById("job-image-grid").innerHTML = images.map(function (image) {
        return '<button class="job-image-card" data-image="' + encodeURIComponent(image.filename) + '"><img src="' + window.API.thumbUrl(state.project, image.filename) + '"><span>' + window.UI.escapeHtml(image.filename) + '</span><small>' + (image.ann_count || 0) + ' annotations</small></button>';
      }).join("");
      document.querySelectorAll("[data-image]").forEach(function (button) { button.onclick = function () { state.currentImage = decodeURIComponent(button.dataset.image); window.__nav("annotate"); }; });
    }
    document.getElementById("job-refresh-images").onclick = loadImages;
    try { await loadImages(); } catch (e) { window.UI.toast("Could not load job images", "err"); }
  }

  window.Pages.annotate = function (host) {
    const U = window.UI;
    const state = window.__state;

    if (!state.currentImage) {
      annotationBoard(host, state);
      return;
    }

    host.innerHTML = `
      <div class="page">
        <div class="page-head">
          <button class="btn mini" id="an-back">← Dataset</button>
          <h1 class="page-title" style="font-size:var(--fs-5)" id="an-title">Annotate</h1>
          <span class="page-sub" id="an-sub">—</span>
          <div class="page-actions">
            <button class="btn" id="an-autolabel">🤖 Auto annotate</button>
            <button class="btn" id="an-smart-select">✦ Smart selection</button>
            <button class="btn hidden" id="an-ai-reject">Reject AI</button>
            <button class="btn primary hidden" id="an-ai-accept">Accept AI</button>
            <button class="btn" id="an-create-version">Create version</button>
            <label class="row split-assignment">Split <select class="input" id="an-dataset-split" aria-label="Move image to dataset split"><option value="">Auto</option><option value="train">Train</option><option value="val">Valid</option><option value="test">Test</option></select></label>
            <button class="btn" id="an-save">Save</button>
            <button class="btn primary" id="an-save-next">Save &amp; Next</button>
            <button class="btn danger" id="an-delete-image">Delete image</button>
          </div>
        </div>

        <div class="editor-wrap">
          <div class="toolbar">
            <button data-tool="box" class="tool active">Box <span class="k">B</span></button>
            <button data-tool="polygon" class="tool">Polygon <span class="k">P</span></button>
            <button data-tool="obb" class="tool">OBB</button>
            <button data-tool="pan" class="tool">Pan</button>
            <button id="an-smart-select-tool" data-tool="smart" class="tool">✦ Smart select</button>
            <span class="sep"></span>
            <button id="an-zoom-out" class="tool">−</button>
            <span class="zoom-label" id="an-zoom">100%</span>
            <button id="an-zoom-in" class="tool">+</button>
            <button id="an-fit" class="tool">Fit</button>
            <span class="sep"></span>
            <button id="an-undo" class="tool">↶</button>
            <button id="an-redo" class="tool">↷</button>
            <span class="sep"></span>
            <button id="an-prev" class="tool">←</button>
            <button id="an-next" class="tool">→</button>
          </div>

          <div class="canvas-container" id="an-canvas-wrap">
            <div class="smart-select-panel hidden" id="smart-select-panel">
              <div class="smart-select-header">
                <div class="smart-select-title">Smart Select</div>
                <button class="smart-select-close" id="smart-select-close" aria-label="Close">×</button>
              </div>

              <div class="smart-select-row">
                <label class="smart-select-field">
                  <span>Model:</span>
                  <select class="smart-select-input">
                    <option>SAM3</option>
                    <option>SAM2</option>
                  </select>
                </label>
              </div>

              <div class="smart-select-segments">
                <button class="segment-toggle active" id="smart-select-polygon" type="button">Polygon</button>
                <button class="segment-toggle" id="smart-select-pixels" type="button">Pixels</button>
              </div>

              <div class="smart-select-note">
                Click outside of the area to add to it or inside to remove from it.
              </div>

              <div class="smart-select-actions secondary">
                <button type="button" id="smart-select-undo" class="smart-select-mini">Undo</button>
                <button type="button" id="smart-select-redo" class="smart-select-mini">Redo</button>
              </div>

              <div class="smart-select-slider">
                <span>Simple</span>
                <input type="range" min="0" max="100" value="50" />
                <span>Complex</span>
              </div>

              <div class="smart-select-actions primary">
                <button type="button" id="smart-select-delete" class="smart-select-delete">Delete</button>
                <button type="button" id="smart-select-finish" class="smart-select-finish">Finish (Enter)</button>
              </div>
            </div>

            <div class="empty-state hidden" id="an-empty">
              <h2>Pick an image</h2>
              <p>Go back to Dataset and click a thumbnail.</p>
            </div>
            <canvas id="canvas"></canvas>
          </div>
        </div>
      </div>
    `;

    const propsPanel = document.querySelector("#right-sidebar .props");
    if (propsPanel && !document.getElementById("annotation-list")) {
      const empty = document.getElementById("props-empty");
      const list = document.createElement("div");
      list.id = "annotation-list";
      list.className = "list";
      propsPanel.insertBefore(list, empty ? empty.nextSibling : propsPanel.firstChild);
    }

    // --- Canvas -------------------------------------------------
    const canvas = new window.AnnotationCanvas(
      document.getElementById("canvas"),
      {
        onChange: function () { autosave(); refreshProps(); },
        onSelect: function () { refreshProps(); },
        onSmartSelect: function (prompt) { handleSmartPrompt(prompt); },
        onEditStart: function () { pushHistory(); }
      }
    );
    window.__canvas = canvas;

    // Force a resize after the layout settles. Fixes 0×0 containers.
    requestAnimationFrame(function () {
      canvas._resize();
      setTimeout(function () { canvas._resize(); }, 40);
    });

    // --- Undo/redo ---------------------------------------------
    const history = [];
    const future = [];
    let pendingAi = null;
    function pushHistory() {
      history.push(JSON.stringify(canvas.annotations));
      future.length = 0;
      if (history.length > 200) history.shift();
    }
    function undo() {
      if (!history.length) return;
      future.push(JSON.stringify(canvas.annotations));
      canvas.setAnnotations(JSON.parse(history.pop()));
      autosave();
      refreshProps();
    }
    function redo() {
      if (!future.length) return;
      history.push(JSON.stringify(canvas.annotations));
      canvas.setAnnotations(JSON.parse(future.pop()));
      autosave();
      refreshProps();
    }

    // --- Tools --------------------------------------------------
    const toolBox = new window.Tools.BoxTool();
    const toolPan = new window.Tools.PanTool();
    const toolPoly = new window.Tools.PolygonTool();
    const toolObb = new window.Tools.ObbTool();
    const toolSmart = new window.Tools.SmartSelectTool();
    const toolMap = {
      box: toolBox, pan: toolPan, polygon: toolPoly, obb: toolObb, smart: toolSmart
    };

    function setTool(name) {
      const buttons = host.querySelectorAll("[data-tool]");
      buttons.forEach(function (b) {
        b.classList.toggle("active", b.dataset.tool === name);
      });
      const smartPanel = document.getElementById("smart-select-panel");
      if (smartPanel) {
        smartPanel.classList.toggle("hidden", name !== "smart");
      }
      canvas.setTool(toolMap[name]);
    }
    host.querySelectorAll("[data-tool]").forEach(function (b) {
      b.onclick = function () { setTool(b.dataset.tool); };
    });
    document.getElementById("smart-select-close").onclick = function () {
      setTool("box");
    };

    document.getElementById("smart-select-undo").onclick = function () {
      undo();
    };
    document.getElementById("smart-select-redo").onclick = function () {
      redo();
    };
    document.getElementById("smart-select-delete").onclick = function () {
      if (document.getElementById("btn-delete-ann")) {
        document.getElementById("btn-delete-ann").click();
      }
    };
    document.getElementById("smart-select-finish").onclick = async function () {
      try {
        await saveNow();
        setTool("box");
        U.toast("Smart selection finished", "ok");
      } catch (e) {
        U.toast("Finish failed: " + e.message, "err");
      }
    };

    document.getElementById("smart-select-polygon").onclick = function () {
      document.getElementById("smart-select-polygon").classList.add("active");
      document.getElementById("smart-select-pixels").classList.remove("active");
    };
    document.getElementById("smart-select-pixels").onclick = function () {
      document.getElementById("smart-select-pixels").classList.add("active");
      document.getElementById("smart-select-polygon").classList.remove("active");
    };
    setTool("box");

    document.getElementById("an-zoom-in").onclick = function () { canvas.zoomBy(1.25); updateZoom(); };
    document.getElementById("an-zoom-out").onclick = function () { canvas.zoomBy(0.8); updateZoom(); };
    document.getElementById("an-fit").onclick = function () { canvas.fit(); updateZoom(); };
    document.getElementById("an-undo").onclick = undo;
    document.getElementById("an-redo").onclick = redo;
    document.getElementById("an-prev").onclick = function () { loadImageByOffset(-1); };
    document.getElementById("an-next").onclick = function () { loadImageByOffset(+1); };
    document.getElementById("an-back").onclick = function () { window.__nav("dataset"); };
    const imageSplitSelect = document.getElementById("an-dataset-split");
    imageSplitSelect.onchange = async function () {
      try {
        await window.API.setDatasetSplit(state.project, state.currentImage, imageSplitSelect.value);
        const image = (state.images || []).find(function (item) { return item.filename === state.currentImage; });
        if (image) image.dataset_split = imageSplitSelect.value || null;
        U.toast(imageSplitSelect.value ? "Image moved to " + imageSplitSelect.options[imageSplitSelect.selectedIndex].text : "Image uses automatic split", "ok");
      } catch (e) { U.toast("Could not move image: " + e.message, "err"); }
    };

    function updateZoom() {
      document.getElementById("an-zoom").textContent =
        Math.round(canvas.zoom * 100) + "%";
      const sz = document.getElementById("status-zoom");
      if (sz) sz.textContent = Math.round(canvas.zoom * 100) + "%";
    }

    // --- Load image --------------------------------------------
    async function loadImage(filename) {
      if (!filename) return;
      state.currentImage = filename;

      const empty = document.getElementById("an-empty");
      if (empty) empty.classList.add("hidden");

      document.getElementById("an-title").textContent = filename;
      document.getElementById("an-title").title = filename;
      document.getElementById("an-sub").textContent = state.project || "";
      imageSplitSelect.value = "";
      try {
        const matching = await window.API.listImages(state.project, filename);
        const current = matching.find(function (image) { return image.filename === filename; });
        if (current) imageSplitSelect.value = current.dataset_split || "";
      } catch (e) { console.warn("[annotate] could not load image split", e); }

      canvas.setClasses(state.classes);

      const url = window.API.imageUrl(state.project, filename);
      console.log("[annotate] loading", url);
      canvas.setImage(url);

      try {
        const anns = await window.API.getAnnotations(state.project, filename);
        anns.forEach(function (a) {
          if (!a.id) a.id = "a" + Math.random().toString(36).slice(2, 9);
        });
        canvas.setAnnotations(anns);
      } catch (e) {
        console.warn("[annotate] could not load annotations:", e);
        canvas.setAnnotations([]);
      }
      history.length = 0;
      future.length = 0;
      refreshProps();
    }

    async function loadImageByOffset(d) {
      const list = state.images || [];
      if (!list.length) return;
      let idx = -1;
      for (let i = 0; i < list.length; i++) {
        if (list[i].filename === state.currentImage) { idx = i; break; }
      }
      if (idx < 0) idx = 0;
      const ni = Math.max(0, Math.min(list.length - 1, idx + d));
      if (list[ni]) {
        await saveNow();
        await loadImage(list[ni].filename);
      }
    }

    // --- Autosave ----------------------------------------------
    let saveTimer = null;
    async function saveNow() {
      if (!state.project || !state.currentImage) return;
      await window.API.saveAnnotations(
        state.project, state.currentImage, canvas.annotations
      );
      const chip = document.getElementById("save-status");
      if (chip) {
        chip.classList.add("chip-ok");
        const dot = chip.querySelector(".dot");
        if (dot) dot.style.background = "var(--ok)";
      }
    }
    function autosave() {
      if (!state.project || !state.currentImage) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async function () {
        try {
          await saveNow();
        } catch (e) {
          U.toast("Save failed: " + e.message, "err");
        }
      }, 250);
    }

    // --- Properties panel --------------------------------------
    function refreshProps() {
      const a = canvas.getSelected();
      const pe = document.getElementById("props-empty");
      const pb = document.getElementById("props-body");
      if (!pe || !pb) return;
      const list = document.getElementById("annotation-list");
      if (list) {
        list.innerHTML = "";
        canvas.annotations.forEach(function (item, index) {
          const row = document.createElement("button");
          row.className = "list-row" + (item.id === canvas.selectedId ? " active" : "");
          row.textContent = (index + 1) + " · " + className(item.class_id);
          row.onclick = function () { canvas.setSelected(item.id); };
          list.appendChild(row);
        });
      }
      pe.classList.toggle("hidden", !!a);
      pb.classList.toggle("hidden", !a);
      const cnt = document.getElementById("status-anns");
      if (cnt) cnt.textContent = canvas.annotations.length;
      if (!a) return;

      document.getElementById("prop-type").value = a.type;
      const sel = document.getElementById("prop-class");
      if (sel) {
        sel.innerHTML = "";
        state.classes.forEach(function (c) {
          const o = document.createElement("option");
          o.value = c.id;
          o.textContent = c.id + " · " + c.name;
          sel.appendChild(o);
        });
        sel.value = a.class_id;
      }
      if (a.type === "box") {
        document.getElementById("prop-x").value = a.x.toFixed(4);
        document.getElementById("prop-y").value = a.y.toFixed(4);
        document.getElementById("prop-w").value = a.w.toFixed(4);
        document.getElementById("prop-h").value = a.h.toFixed(4);
        document.getElementById("prop-conf").value =
          (a.confidence == null ? 1 : a.confidence).toFixed(2);
      }
    }

    function className(id) {
      const c = state.classes.find(function (item) { return item.id === id; });
      return c ? c.name : "class " + id;
    }

    const propClass = document.getElementById("prop-class");
    if (propClass) {
      propClass.onchange = function (e) {
        const a = canvas.getSelected(); if (!a) return;
        a.class_id = parseInt(e.target.value, 10);
        canvas.render(); autosave();
      };
    }
    ["prop-x", "prop-y", "prop-w", "prop-h"].forEach(function (id) {
      const n = document.getElementById(id);
      if (!n) return;
      n.onchange = function () {
        const a = canvas.getSelected();
        if (!a || a.type !== "box") return;
        a.x = parseFloat(document.getElementById("prop-x").value);
        a.y = parseFloat(document.getElementById("prop-y").value);
        a.w = parseFloat(document.getElementById("prop-w").value);
        a.h = parseFloat(document.getElementById("prop-h").value);
        canvas.render(); autosave();
      };
    });
    const delBtn = document.getElementById("btn-delete-ann");
    if (delBtn) {
      delBtn.onclick = function () {
        const a = canvas.getSelected(); if (!a) return;
        canvas.annotations = canvas.annotations.filter(function (x) {
          return x.id !== a.id;
        });
        canvas.setSelected(null);
        canvas.render();
        autosave();
      };
    }

    // --- Classes panel -----------------------------------------
    function renderClasses() {
      const ul = document.getElementById("class-list");
      if (!ul) return;
      ul.innerHTML = "";
      state.classes.forEach(function (c) {
        const li = document.createElement("li");
        const sw = document.createElement("span");
        sw.style.cssText = "width:10px;height:10px;border-radius:3px;background:" +
          (c.color || "#4f8cff");
        const name = document.createElement("input");
        name.value = c.name;
        name.style.cssText =
          "background:transparent;border:0;color:var(--fg);outline:0;width:100%";
        name.onchange = async function () {
          const next = name.value.trim();
          if (!next) { name.value = c.name; return; }
          if (state.classes.some(function (item) {
            return item !== c && item.name.toLowerCase() === next.toLowerCase();
          })) {
            name.value = c.name;
            return U.toast("Class names must be unique", "warn");
          }
          c.name = next;
          await window.API.saveClasses(state.project, state.classes);
          refreshProps();
        };
        li.onclick = function () {
          state.activeClassId = c.id;
          renderClasses();
        };
        const x = document.createElement("span");
        x.textContent = "✕";
        x.style.color = "var(--muted)";
        x.style.cursor = "pointer";
        x.onclick = async function () {
          if (!confirm("Delete class \"" + c.name + "\"?")) return;
          state.classes = state.classes.filter(function (k) { return k !== c; });
          await window.API.saveClasses(state.project, state.classes);
          renderClasses();
          canvas.setClasses(state.classes);
        };
        li.appendChild(sw);
        li.appendChild(name);
        li.appendChild(x);
        ul.appendChild(li);
      });
    }

    const addClassBtn = document.getElementById("btn-add-class");
    if (addClassBtn) {
      addClassBtn.onclick = async function () {
        const className = (prompt("Class name:") || "").trim();
        if (!className) return;
        if (state.classes.some(function (c) {
          return c.name.toLowerCase() === className.toLowerCase();
        })) return U.toast("That class already exists", "warn");
        const id = state.classes.reduce(function (max, c) {
          return Math.max(max, Number(c.id) || 0);
        }, -1) + 1;
        const hue = (id * 67) % 360;
        state.classes.push({
          id: id,
          name: className,
          color: "hsl(" + hue + ",70%,55%)"
        });
        await window.API.saveClasses(state.project, state.classes);
        renderClasses();
        canvas.setClasses(state.classes);
        state.activeClassId = id;
      };
    }

    const mr = document.getElementById("btn-mark-reviewed");
    if (mr) {
      mr.onclick = async function () {
        if (!state.currentImage) return;
        await window.API.setReviewed(state.project, state.currentImage, true);
        U.toast("Marked reviewed", "ok");
      };
    }
    const mu = document.getElementById("btn-mark-unreviewed");
    if (mu) {
      mu.onclick = async function () {
        if (!state.currentImage) return;
        await window.API.setReviewed(state.project, state.currentImage, false);
        U.toast("Marked unreviewed", "ok");
      };
    }

    document.getElementById("an-save").onclick = async function () {
      try { await saveNow(); U.toast("Saved to the dataset", "ok"); state.currentImage = null; annotationBoard(host, state); }
      catch (e) { U.toast("Save failed: " + e.message, "err"); }
    };

    document.getElementById("an-save-next").onclick = async function () {
      try {
        await saveNow();
        // Keep the annotation queue focused on images that still need labels.
        const savedImage = state.currentImage;
        state.dataset = state.dataset || {};
        state.dataset.unannotated = true;
        const remaining = await window.API.listImages(state.project, "", true);
        state.images = remaining;
        const next = remaining.find(function (image) { return image.filename !== savedImage; });
        if (next) {
          state.currentImage = next.filename;
          await loadImage(next.filename);
          U.toast("Saved. Opened the next unannotated image.", "ok");
        } else {
          state.currentImage = null;
          U.toast(remaining.length ? "Saved. No other unannotated images remain." : "Saved. All images are annotated.", "ok");
          annotationBoard(host, state);
        }
      } catch (e) { U.toast("Save failed: " + e.message, "err"); }
    };

    document.getElementById("an-delete-image").onclick = async function () {
      if (!state.project || !state.currentImage) return;
      if (!confirm("Delete the current image '" + state.currentImage + "'? This removes it from the dataset.")) return;
      try {
        await window.API.deleteImages(state.project, [state.currentImage]);
        U.toast("Image deleted", "ok");
        state.dataset = state.dataset || { query: "", unannotated: false, reviewed: null, selected: new Set(), sort: "name" };
        state.dataset.selected.delete(state.currentImage);
        state.currentImage = null;
        window.__nav("dataset");
      } catch (e) {
        U.toast("Delete image failed: " + e.message, "err");
      }
    };

    document.getElementById("an-create-version").onclick = async function () {
      const note = prompt("Version note:", "Before training");
      if (note === null || !state.project) return;
      try {
        await saveNow();
        const v = await window.API.createVersion(state.project, note);
        U.toast(v.name + " created", "ok");
      } catch (e) { U.toast("Create version failed: " + e.message, "err"); }
    };

    function showAiReview(existing) {
      pendingAi = existing;
      document.getElementById("an-ai-reject").classList.remove("hidden");
      document.getElementById("an-ai-accept").classList.remove("hidden");
    }
    document.getElementById("an-ai-reject").onclick = function () {
      if (!pendingAi) return;
      canvas.setAnnotations(pendingAi);
      pendingAi = null;
      document.getElementById("an-ai-reject").classList.add("hidden");
      document.getElementById("an-ai-accept").classList.add("hidden");
      refreshProps();
    };
    document.getElementById("an-ai-accept").onclick = async function () {
      if (!pendingAi) return;
      pendingAi = null;
      document.getElementById("an-ai-reject").classList.add("hidden");
      document.getElementById("an-ai-accept").classList.add("hidden");
      try { await saveNow(); U.toast("AI annotations accepted", "ok"); }
      catch (e) { U.toast("Save failed: " + e.message, "err"); }
    };

    async function runAutoAnnotation(segmentation) {
      if (!state.currentImage) return U.toast("Open an image first", "warn");
      const models = await window.API.models();
      if (!models.length) return U.toast("No .pt models in ./models/", "warn");
      const idx = parseInt(prompt("Model index:\n" +
        models.map(function (m, i) { return i + ": " + m.name; }).join("\n")), 10);
      if (isNaN(idx) || !models[idx]) return;
      try {
        const r = await window.API.autolabel(state.project, {
          mode: "current", filename: state.currentImage,
          model_path: models[idx].path, conf: 0.25, iou: 0.45,
          segmentation: segmentation, class_id: state.activeClassId || 0,
          preview: true
        });
        const kind = segmentation ? "segments" : "annotations";
        U.toast("Added " + r.added + " " + kind, "ok");
        pushHistory();
        canvas.setAnnotations(r.annotations);
        showAiReview(r.annotations.slice(0, r.annotations.length - r.added));
        refreshProps();
      } catch (e) { U.toast("Auto annotate failed: " + e.message, "err"); }
    }

    document.getElementById("an-autolabel").onclick = function () {
      runAutoAnnotation(false);
    };
    document.getElementById("an-smart-select").onclick = function () {
      startSmartSelection();
    };
    document.getElementById("an-smart-select-tool").onclick = function () {
      startSmartSelection();
    };

    async function startSmartSelection() {
      const models = await window.API.models();
      const samModels = models.filter(function (model) {
        return model.kind === "sam" || model.name.toLowerCase().indexOf("sam2") === 0;
      });
      if (!samModels.length) {
        return U.toast("Add sam2.1_l.pt to the models folder first", "warn");
      }
      state.smartModelPath = samModels[0].path;
      state.smartModelReady = false;
      setTool("smart");
      const smartPanel = document.getElementById("smart-select-panel");
      if (smartPanel) smartPanel.classList.remove("hidden");
      U.toast("Smart Selection ready: click or drag a box", "ok");
      window.API.warmModel(state.smartModelPath).then(function () {
        state.smartModelReady = true;
        U.toast("Smart Selection model loaded", "ok");
      }).catch(function (e) {
        if (e.message.indexOf("404") !== -1) {
          state.smartModelReady = true;
          U.toast("Smart Selection will load on first use", "warn");
        } else {
          state.smartModelReady = false;
          U.toast("Smart Selection model failed to load: " + e.message, "err");
        }
      });
    }

    async function handleSmartPrompt(prompt) {
      if (!state.smartModelPath || !state.currentImage) return;
      if (!state.smartModelReady) {
        return U.toast("Smart Selection is still loading; try again in a moment", "warn");
      }
      try {
        const payload = {
          filename: state.currentImage,
          model_path: state.smartModelPath,
          class_id: state.activeClassId || 0
        };
        if (prompt.type === "box") {
          payload.box = [
            Math.max(0, Math.min(1, prompt.x)),
            Math.max(0, Math.min(1, prompt.y)),
            Math.max(0, Math.min(1, prompt.w)),
            Math.max(0, Math.min(1, prompt.h))
          ];
        } else {
          payload.x = Math.max(0, Math.min(1, prompt.x));
          payload.y = Math.max(0, Math.min(1, prompt.y));
        }
        const r = await window.API.smartSelect(state.project, payload);
        if (!r.new_annotations || !r.new_annotations.length) {
          return U.toast("SAM did not find an object in that prompt", "warn");
        }
        pushHistory();
        canvas.setAnnotations(r.annotations);
        showAiReview(r.annotations.slice(0, r.annotations.length - r.added));
        U.toast("Object segmented", "ok");
      } catch (e) {
        U.toast("Smart Selection failed: " + e.message, "err");
      }
    }

    // --- Keyboard ----------------------------------------------
    const kh = function (e) {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" ||
          tag === "select" || e.target.isContentEditable) return;
      if (e.key === "b" || e.key === "B") setTool("box");
      else if (e.key === "p" || e.key === "P") setTool("polygon");
      else if (e.key === "ArrowRight" || e.key === "n" || e.key === "N") loadImageByOffset(+1);
      else if (e.key === "ArrowLeft" || e.key === "p" || e.key === "P") loadImageByOffset(-1);
      else if (e.key === "r" || e.key === "R") {
        const review = document.getElementById("btn-mark-reviewed");
        if (review) review.click();
      }
      else if (/^[1-9]$/.test(e.key)) {
        const cls = state.classes[parseInt(e.key, 10) - 1];
        if (cls) { state.activeClassId = cls.id; renderClasses(); }
      }
      else if (e.key === "Delete") { if (delBtn) delBtn.click(); }
      else if (e.ctrlKey && (e.key === "z" || e.key === "Z")) { e.preventDefault(); undo(); }
      else if (e.ctrlKey && (e.key === "y" || e.key === "Y")) { e.preventDefault(); redo(); }
      else if (e.ctrlKey && (e.key === "s" || e.key === "S")) { e.preventDefault(); autosave(); }
      if (canvas._tool && canvas._tool.onKey) canvas._tool.onKey(e);
    };
    document.addEventListener("keydown", kh);

    // --- Boot --------------------------------------------------
    canvas.setClasses(state.classes);
    renderClasses();
    refreshProps();
    updateZoom();
    if (state.currentImage) {
      loadImage(state.currentImage);
    } else {
      const empty = document.getElementById("an-empty");
      if (empty) empty.classList.remove("hidden");
    }

    // expose for parent app
    window.__loadImageInEditor = loadImage;
  };
})();
