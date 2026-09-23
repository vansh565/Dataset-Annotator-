/* Vertex · Dataset page */
(function () {
  "use strict";
  window.Pages = window.Pages || {};

  window.Pages.dataset = function (host) {
    const U = window.UI;
    const state = window.__state;

    state.dataset = state.dataset || {
      query: "", unannotated: false, annotationStatus: "", split: "", reviewed: null,
      selected: new Set(), sort: "name"
    };

    host.innerHTML = `
      <div class="page">
        <div class="page-head">
          <h1 class="page-title">Dataset</h1>
          <span class="page-sub" id="ds-sub">—</span>
          <div class="page-actions">
            <button class="btn" id="ds-import-files">Import files</button>
            <button class="btn" id="ds-import-folder">Import folder</button>
            <button class="btn" id="ds-import-zip">Import ZIP</button>
            <div class="more-wrap">
              <button class="btn icon" id="ds-more-btn" aria-label="More actions">⋯</button>
              <div class="more-menu hidden" id="ds-more-menu">
                <button type="button" id="ds-menu-delete-selected">Delete selected images</button>
                <button type="button" id="ds-menu-delete-dataset" class="danger">Delete dataset</button>
              </div>
            </div>
          </div>
        </div>

        <div class="filters">
          <div class="grow">
            <input id="ds-search" class="search" placeholder="Search by filename…" />
          </div>
          <select id="ds-reviewed" class="input">
            <option value="">All</option>
            <option value="0">Unreviewed</option>
            <option value="1">Reviewed</option>
          </select>
          <select id="ds-sort" class="input">
            <option value="name">Sort · Name</option>
            <option value="anns">Sort · Annotations</option>
          </select>
          <select id="ds-annotation-status" class="input" aria-label="Annotation status">
            <option value="">All annotation status</option>
            <option value="unannotated">Unannotated only</option>
            <option value="annotated">Annotated only</option>
          </select>
          <select id="ds-split-filter" class="input" aria-label="Dataset split">
            <option value="">All splits</option><option value="train">Train</option>
            <option value="val">Validation</option><option value="test">Test</option>
          </select>
        </div>

        <div class="page-body" id="ds-body"></div>

        <div class="actionbar">
          <span class="count" id="ds-sel-count">0 selected</span>
          <button class="btn mini" id="ds-select-all">Select all</button>
          <button class="btn mini" id="ds-clear-sel">Clear</button>
          <div class="spacer" style="flex:1"></div>
          <button class="btn mini" id="ds-mark-reviewed" disabled>Mark reviewed</button>
          <button class="btn mini" id="ds-mark-unreviewed" disabled>Mark unreviewed</button>
          <button class="btn mini danger" id="ds-delete" disabled>Delete</button>
        </div>
      </div>
    `;

    const searchEl = document.getElementById("ds-search");
    const reviewedEl = document.getElementById("ds-reviewed");
    const sortEl = document.getElementById("ds-sort");
    const statusEl = document.getElementById("ds-annotation-status");
    const splitFilterEl = document.getElementById("ds-split-filter");

    searchEl.value = state.dataset.query || "";
    reviewedEl.value = state.dataset.reviewed === null ||
      state.dataset.reviewed === undefined ? "" : String(state.dataset.reviewed);
    sortEl.value = state.dataset.sort || "name";
    statusEl.value = state.dataset.annotationStatus || (state.dataset.unannotated ? "unannotated" : "");
    splitFilterEl.value = state.dataset.split || "";

    let qTimer = null;
    searchEl.oninput = function () {
      clearTimeout(qTimer);
      qTimer = setTimeout(function () {
        state.dataset.query = searchEl.value.trim();
        refresh();
      }, 180);
    };
    reviewedEl.onchange = function () {
      const v = reviewedEl.value;
      state.dataset.reviewed = v === "" ? null : parseInt(v, 10);
      refresh();
    };
    sortEl.onchange = function () {
      state.dataset.sort = sortEl.value;
      render();
    };
    statusEl.onchange = function () {
      state.dataset.annotationStatus = statusEl.value;
      state.dataset.unannotated = statusEl.value === "unannotated";
      refresh();
    };
    splitFilterEl.onchange = function () {
      state.dataset.split = splitFilterEl.value;
      refresh();
    };

    document.getElementById("ds-import-files").onclick = function () {
      pickFiles(false);
    };
    document.getElementById("ds-import-folder").onclick = function () {
      pickFiles(true);
    };
    document.getElementById("ds-import-zip").onclick = function () {
      const p = prompt("Full path to .zip:");
      if (!p) return;
      window.API.importZip(state.project, p).then(function (r) {
        U.toast("Imported " + r.added + ", skipped " + r.skipped, "ok");
        refresh();
      }).catch(function (e) { U.toast(e.message, "err"); });
    };

    function pickFiles(folder) {
      if (!state.project) return U.toast("Select a project first", "warn");
      const input = document.createElement("input");
      input.type = "file";
      if (folder) { input.webkitdirectory = true; }
      input.multiple = true;
      input.onchange = async function () {
        const files = [].slice.call(input.files);
        if (!files.length) return;
        const fd = new FormData();
        files.forEach(function (f) { fd.append("files", f); });
        try {
          const r = await fetch("/api/projects/" + state.project + "/import",
            { method: "POST", body: fd }).then(function (x) { return x.json(); });
          U.toast("Imported " + r.added + ", skipped " + r.skipped, "ok");
          refresh();
        } catch (e) { U.toast("Import failed: " + e.message, "err"); }
      };
      input.click();
    }

    function updateSelUI() {
      const n = state.dataset.selected.size;
      document.getElementById("ds-sel-count").textContent = n + " selected";
      document.getElementById("ds-mark-reviewed").disabled = n === 0;
      document.getElementById("ds-mark-unreviewed").disabled = n === 0;
      document.getElementById("ds-delete").disabled = n === 0;
    }

    document.getElementById("ds-select-all").onclick = function () {
      (state.images || []).forEach(function (i) {
        state.dataset.selected.add(i.filename);
      });
      render();
    };
    document.getElementById("ds-clear-sel").onclick = function () {
      state.dataset.selected.clear();
      render();
    };
    document.getElementById("ds-mark-reviewed").onclick = async function () {
      const files = Array.from(state.dataset.selected);
      for (let i = 0; i < files.length; i++) {
        await window.API.setReviewed(state.project, files[i], true);
      }
      state.dataset.selected.clear();
      U.toast("Marked reviewed", "ok");
      refresh();
    };
    document.getElementById("ds-mark-unreviewed").onclick = async function () {
      const files = Array.from(state.dataset.selected);
      for (let i = 0; i < files.length; i++) {
        await window.API.setReviewed(state.project, files[i], false);
      }
      state.dataset.selected.clear();
      U.toast("Marked unreviewed", "ok");
      refresh();
    };
    document.getElementById("ds-delete").onclick = async function () {
      const files = Array.from(state.dataset.selected);
      if (!confirm("Delete " + files.length + " image(s)? Removes files from disk.")) return;
      await window.API.deleteImages(state.project, files);
      state.dataset.selected.clear();
      U.toast("Deleted " + files.length, "ok");
      refresh();
    };

    document.getElementById("ds-more-btn").onclick = function (e) {
      e.stopPropagation();
      const menu = document.getElementById("ds-more-menu");
      if (!menu) return;
      menu.classList.toggle("hidden");
    };

    document.getElementById("ds-menu-delete-selected").onclick = async function () {
      const files = Array.from(state.dataset.selected);
      if (!files.length) {
        U.toast("Select one or more images first", "warn");
        return;
      }
      if (!confirm("Delete " + files.length + " image(s)? Removes files from disk.")) return;
      await window.API.deleteImages(state.project, files);
      state.dataset.selected.clear();
      document.getElementById("ds-more-menu").classList.add("hidden");
      U.toast("Deleted " + files.length, "ok");
      refresh();
    };

    document.getElementById("ds-menu-delete-dataset").onclick = async function () {
      if (!state.project) return;
      if (!confirm("Delete the whole dataset/project '" + state.project + "'? This removes all images, annotations, and classes.")) return;
      try {
        await window.API.deleteProject(state.project);
        document.getElementById("ds-more-menu").classList.add("hidden");
        state.project = null;
        state.currentImage = null;
        state.images = [];
        state.dataset.selected.clear();
        U.toast("Dataset deleted", "ok");
        window.__nav("dataset");
        if (window.__loadProject) {
          window.__loadProject(window.__state.project || "");
        }
      } catch (e) {
        U.toast("Delete dataset failed: " + e.message, "err");
      }
    };

    document.addEventListener("click", function (e) {
      const menu = document.getElementById("ds-more-menu");
      if (menu && !menu.contains(e.target) && e.target.id !== "ds-more-btn") {
        menu.classList.add("hidden");
      }
    });

    function render() {
      const body = document.getElementById("ds-body");
      const images = state.images || [];

      if (!state.project) {
        body.innerHTML = `<div class="empty"><h3>No project selected</h3>
          <p>Create or pick a project from the top bar.</p></div>`;
        return;
      }
      if (!images.length) {
        body.innerHTML = `<div class="empty"><h3>No images</h3>
          <p>Import files, a folder, or a ZIP.</p></div>`;
        return;
      }

      const sorted = images.slice();
      if (state.dataset.sort === "anns") {
        sorted.sort(function (a, b) {
          return (b.ann_count || 0) - (a.ann_count || 0);
        });
      } else {
        sorted.sort(function (a, b) {
          return a.filename.localeCompare(b.filename);
        });
      }

      const grid = document.createElement("div");
      grid.className = "grid";

      sorted.forEach(function (img) {
        const selected = state.dataset.selected.has(img.filename);
        const card = document.createElement("div");
        card.className = "card" + (selected ? " selected" : "");

        const thumb = document.createElement("div");
        thumb.className = "card-thumb";
        const im = document.createElement("img");
        im.loading = "lazy";
        im.src = window.API.thumbUrl(state.project, img.filename);
        thumb.appendChild(im);

        const badges = document.createElement("div");
        badges.className = "card-badges";
        const b1 = document.createElement("span");
        b1.className = "card-badge";
        b1.textContent = (img.ann_count || 0) + " ann";
        badges.appendChild(b1);
        const b2 = document.createElement("span");
        b2.className = "card-badge " + (img.reviewed ? "reviewed" : "unreviewed");
        b2.textContent = img.reviewed ? "reviewed" : "unreviewed";
        badges.appendChild(b2);
        thumb.appendChild(badges);

        const check = document.createElement("div");
        check.className = "card-check";
        check.textContent = selected ? "✓" : "";
        thumb.appendChild(check);

        const meta = document.createElement("div");
        meta.className = "card-meta";
        const name = document.createElement("div");
        name.className = "card-name";
        name.textContent = img.filename;
        name.title = img.filename;
        meta.appendChild(name);
        const sub = document.createElement("div");
        sub.className = "card-sub";
        sub.innerHTML = "<span>" + img.width + "×" + img.height + "</span>" +
          '<span class="spacer"></span>' +
          "<span>" + U.fmtBytes(img.size_bytes) + "</span>";
        meta.appendChild(sub);

        const split = document.createElement("select");
        split.className = "input image-split-select";
        split.setAttribute("aria-label", "Assign dataset split");
        split.innerHTML = '<option value="">Auto split</option><option value="train">Train</option><option value="val">Validation</option><option value="test">Test</option>';
        split.value = img.dataset_split || "";
        split.onchange = async function (event) {
          event.stopPropagation();
          try {
            await window.API.setDatasetSplit(state.project, img.filename, split.value);
            img.dataset_split = split.value || null;
            U.toast(split.value ? "Moved to " + split.options[split.selectedIndex].text : "Split set to automatic", "ok");
            if (state.dataset.split && state.dataset.split !== split.value) refresh();
          } catch (e) { U.toast("Could not change split: " + e.message, "err"); }
        };
        split.onclick = function (event) { event.stopPropagation(); };
        meta.appendChild(split);

        card.appendChild(thumb);
        card.appendChild(meta);

        card.onclick = function (e) {
          if (e.ctrlKey || e.metaKey) {
            if (state.dataset.selected.has(img.filename))
              state.dataset.selected.delete(img.filename);
            else
              state.dataset.selected.add(img.filename);
            updateSelUI();
            render();
          } else {
            state.currentImage = img.filename;
            window.__nav("annotate");
          }
        };

        grid.appendChild(card);
      });

      body.innerHTML = "";
      body.appendChild(grid);
      updateSelUI();
    }

    async function refresh() {
      if (!state.project) { render(); return; }
      document.getElementById("ds-sub").textContent = "project: " + state.project;
      try {
        const imgs = await window.API.listImages(
          state.project,
          state.dataset.query,
          state.dataset.unannotated,
          state.dataset.reviewed,
          state.dataset.annotationStatus,
          state.dataset.split
        );
        state.images = imgs;
        const cnt = document.getElementById("nav-dataset-count");
        if (cnt) cnt.textContent = imgs.length;
        render();
      } catch (e) {
        U.toast("Failed to load dataset: " + e.message, "err");
      }
    }

    refresh();
  };
})();
