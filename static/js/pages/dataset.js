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
            <button class="btn primary" id="ds-video-btn">Video frame library</button>
            <div class="more-wrap">
              <button class="btn icon" id="ds-more-btn" aria-label="More actions">⋯</button>
              <div class="more-menu hidden" id="ds-more-menu">
                <button type="button" id="ds-menu-delete-selected">Delete selected images</button>
                <button type="button" id="ds-menu-delete-dataset" class="danger">Delete dataset</button>
              </div>
            </div>
          </div>
        </div>

        <section class="card video-import" id="ds-video-section">
          <div class="row video-import-head">
            <div><h2>Video frame library</h2><p class="muted">Video frames stay in this project until you remove the video set. Add frames to the dataset whenever you want.</p></div>
            <button class="btn mini" id="ds-video-close" type="button">Close</button>
          </div>
          <div id="ds-video-library" class="video-set-list"></div>
          <div class="row video-import-controls">
            <label class="fld">Video file<input id="ds-video-file" class="input" type="file" accept="video/*,.mkv,.avi,.m4v" /></label>
            <label class="fld">Frames per second<input id="ds-video-fps" class="input" type="number" min="0.1" max="10" step="0.1" value="1" /></label>
            <button class="btn primary" id="ds-video-extract" type="button">Extract frames</button>
          </div>
          <div class="row video-import-selection">
            <span id="ds-video-status" class="muted">Choose a video, then extract frames to preview.</span>
            <span class="spacer"></span>
            <button class="btn mini" id="ds-video-select-all" type="button" disabled>Select all</button>
            <button class="btn mini" id="ds-video-clear" type="button" disabled>Clear</button>
            <button class="btn mini primary" id="ds-video-add" type="button" disabled>Add selected frames</button>
          </div>
          <div id="ds-video-frames" class="video-frame-grid"></div>
          <div id="ds-video-lightbox" class="video-frame-lightbox hidden" role="dialog" aria-modal="true" aria-label="Full size video frame">
            <div class="video-frame-lightbox-content"><div class="video-frame-lightbox-actions"><button class="btn mini" id="ds-video-lightbox-close" type="button">Close</button><span class="spacer"></span><button class="btn mini" id="ds-video-frame-select" type="button">Select frame</button><button class="btn mini primary" id="ds-video-frame-prev" type="button">Previous</button><button class="btn mini primary" id="ds-video-frame-next" type="button">Next</button></div><img id="ds-video-lightbox-image" alt="Full size video frame"/><p id="ds-video-lightbox-caption" class="muted"></p></div>
          </div>
        </section>

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
          <button class="btn mini" id="ds-select-all">Select all images</button>
          <button class="btn mini" id="ds-clear-sel">Clear selection</button>
        </div>

        <div class="dataset-drop-zone" id="ds-drop-zone" role="button" tabindex="0" aria-label="Drop image files here or browse to upload">
          <div><b>Drop images here to add them to this dataset</b><span>JPG, PNG, BMP, and WebP</span></div>
          <button type="button" class="btn mini" id="ds-drop-browse">Browse images</button>
        </div>

        <div class="page-body" id="ds-body"></div>

        <div class="actionbar">
          <span class="count" id="ds-sel-count">0 selected</span>
          <div class="spacer" style="flex:1"></div>
          <button class="btn mini" id="ds-mark-reviewed" disabled>Mark reviewed</button>
          <button class="btn mini" id="ds-mark-unreviewed" disabled>Mark unreviewed</button>
          <button class="btn mini danger" id="ds-delete" disabled>Delete selected images</button>
        </div>
      </div>
    `;

    const searchEl = document.getElementById("ds-search");
    const reviewedEl = document.getElementById("ds-reviewed");
    const sortEl = document.getElementById("ds-sort");
    const statusEl = document.getElementById("ds-annotation-status");
    const splitFilterEl = document.getElementById("ds-split-filter");
    const videoSection = document.getElementById("ds-video-section");
    const videoFile = document.getElementById("ds-video-file");
    const videoFrameBox = document.getElementById("ds-video-frames");
    const videoStatus = document.getElementById("ds-video-status");
    const videoLibrary = document.getElementById("ds-video-library");
    const videoLightbox = document.getElementById("ds-video-lightbox");
    const dropZone = document.getElementById("ds-drop-zone");
    let videoSessionId = null;
    let videoFrames = [];
    let videoLightboxIndex = -1;

    document.getElementById("ds-video-btn").onclick = function () {
      videoSection.classList.remove("hidden");
      videoSection.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    document.getElementById("ds-video-close").onclick = function () {
      videoSection.classList.add("hidden");
    };
    document.getElementById("ds-video-extract").onclick = extractVideoFrames;
    document.getElementById("ds-video-select-all").onclick = function () {
      videoFrameBox.querySelectorAll("input[data-frame-id]:not(:disabled)").forEach(function (input) { input.checked = true; });
      updateVideoSelection();
    };
    document.getElementById("ds-video-clear").onclick = function () {
      videoFrameBox.querySelectorAll("input[data-frame-id]").forEach(function (input) { input.checked = false; });
      updateVideoSelection();
    };
    document.getElementById("ds-video-add").onclick = addSelectedVideoFrames;
    document.getElementById("ds-video-lightbox-close").onclick = closeVideoLightbox;
    document.getElementById("ds-video-frame-select").onclick = toggleLightboxFrameSelection;
    document.getElementById("ds-video-frame-prev").onclick = function () { stepVideoFrame(-1); };
    document.getElementById("ds-video-frame-next").onclick = function () { stepVideoFrame(1); };
    videoLightbox.onclick = function (event) { if (event.target === videoLightbox) closeVideoLightbox(); };

    function frameUrl(sessionId, frameId, full) {
      return "/api/projects/" + encodeURIComponent(state.project) + "/video/previews/" +
        encodeURIComponent(sessionId) + "/" + encodeURIComponent(frameId) + ".jpg" + (full ? "?full=1" : "");
    }

    function renderVideoFrames() {
      videoFrameBox.innerHTML = videoFrames.map(function (frame) {
        const added = frame.imported;
        return '<div class="video-frame-card' + (added ? ' is-added' : '') + '">' +
          '<label><input type="checkbox" data-frame-id="' + U.escapeHtml(frame.id) + '" ' + (added ? 'disabled' : '') + '>' +
          '<img loading="lazy" src="' + U.escapeHtml(frameUrl(videoSessionId, frame.id, false)) + '" alt="Video frame ' + Number(frame.number) + '">' +
          '<span>Frame ' + (Number(frame.number) + 1) + ' · ' + Number(frame.seconds).toFixed(2) + ' sec</span></label>' +
          (added ? '<span class="video-frame-added">Added to dataset</span>' : '') +
          '<button class="btn mini video-frame-full" type="button" data-full-frame="' + U.escapeHtml(frame.id) + '">Full view</button></div>';
      }).join("");
      videoFrameBox.querySelectorAll("input[data-frame-id]").forEach(function (input) { input.onchange = updateVideoSelection; });
      videoFrameBox.querySelectorAll("button[data-full-frame]").forEach(function (button) {
        button.onclick = function () { showVideoFrame(button.dataset.fullFrame); };
      });
      updateVideoSelection();
    }

    function showVideoFrame(frameId) {
      videoLightboxIndex = videoFrames.findIndex(function (item) { return item.id === frameId; });
      const frame = videoFrames[videoLightboxIndex];
      if (!frame) return;
      document.getElementById("ds-video-lightbox-image").src = frameUrl(videoSessionId, frame.id, true);
      document.getElementById("ds-video-lightbox-caption").textContent = "Frame " + (Number(frame.number) + 1) + " · " + Number(frame.seconds).toFixed(2) + " sec";
      const checkbox = videoFrameBox.querySelector('input[data-frame-id="' + frame.id + '"]');
      const selectButton = document.getElementById("ds-video-frame-select");
      selectButton.textContent = frame.imported ? "Already added" : (checkbox && checkbox.checked ? "Deselect frame" : "Select frame");
      selectButton.disabled = !!frame.imported;
      document.getElementById("ds-video-frame-prev").disabled = videoLightboxIndex <= 0;
      document.getElementById("ds-video-frame-next").disabled = videoLightboxIndex >= videoFrames.length - 1;
      videoLightbox.classList.remove("hidden");
    }

    function stepVideoFrame(amount) {
      const nextIndex = videoLightboxIndex + amount;
      if (nextIndex >= 0 && nextIndex < videoFrames.length) showVideoFrame(videoFrames[nextIndex].id);
    }

    function toggleLightboxFrameSelection() {
      const frame = videoFrames[videoLightboxIndex];
      if (!frame || frame.imported) return;
      const checkbox = videoFrameBox.querySelector('input[data-frame-id="' + frame.id + '"]');
      if (checkbox) { checkbox.checked = !checkbox.checked; updateVideoSelection(); showVideoFrame(frame.id); }
    }

    function closeVideoLightbox() {
      videoLightbox.classList.add("hidden");
      document.getElementById("ds-video-lightbox-image").removeAttribute("src");
      videoLightboxIndex = -1;
    }

    async function loadVideoLibrary() {
      if (!state.project) { videoLibrary.innerHTML = ""; return; }
      try {
        const sets = await window.API.videoPreviews(state.project);
        videoLibrary.innerHTML = sets.length ? sets.map(function (set) {
          return '<div class="video-set-card"><div><strong>' + U.escapeHtml(set.video_name || "Video") + '</strong>' +
            '<span class="muted">' + Number(set.frame_count) + ' saved frames · ' + Number(set.sample_fps).toFixed(2) + ' FPS</span></div>' +
            '<button class="btn mini" data-open-video-set="' + U.escapeHtml(set.session_id) + '" type="button">Choose frames</button>' +
            '<button class="btn mini danger" data-remove-video-set="' + U.escapeHtml(set.session_id) + '" type="button">Remove set</button></div>';
        }).join("") : '<p class="muted">No saved videos yet. Upload a video to create a reusable frame set.</p>';
        videoLibrary.querySelectorAll("[data-open-video-set]").forEach(function (button) {
          button.onclick = function () { openVideoSet(button.dataset.openVideoSet); };
        });
        videoLibrary.querySelectorAll("[data-remove-video-set]").forEach(function (button) {
          button.onclick = async function () {
            if (!confirm("Remove this saved video and all its extracted frames? Frames already added to the dataset will stay there.")) return;
            try {
              await window.API.discardVideoPreview(state.project, button.dataset.removeVideoSet);
              if (videoSessionId === button.dataset.removeVideoSet) {
                videoSessionId = null; videoFrames = []; videoFrameBox.innerHTML = ""; updateVideoSelection();
                videoStatus.textContent = "Saved video set removed.";
              }
              await loadVideoLibrary();
            } catch (error) { U.toast("Could not remove video set: " + error.message, "err"); }
          };
        });
      } catch (error) { videoLibrary.innerHTML = '<p class="muted">Could not load saved video sets: ' + U.escapeHtml(error.message) + '</p>'; }
    }

    async function openVideoSet(sessionId) {
      try {
        const set = await window.API.videoPreview(state.project, sessionId);
        videoSessionId = set.session_id;
        videoFrames = set.frames || [];
        renderVideoFrames();
        videoStatus.textContent = (videoFrames.length - videoFrames.filter(function (frame) { return frame.imported; }).length) + " frames available to add; added frames stay saved in this video set.";
        videoSection.classList.remove("hidden");
        videoFrameBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } catch (error) { U.toast("Could not open video frames: " + error.message, "err"); }
    }

    async function extractVideoFrames() {
      if (!state.project) return U.toast("Select a project first", "warn");
      if (!videoFile.files || !videoFile.files[0]) return U.toast("Choose a video file first", "warn");
      const fps = Number(document.getElementById("ds-video-fps").value);
      if (!fps || fps < 0.1 || fps > 10) return U.toast("Frame rate must be between 0.1 and 10 FPS", "warn");
      const button = document.getElementById("ds-video-extract");
      button.disabled = true;
      button.textContent = "Extracting…";
      videoStatus.textContent = "Uploading video and extracting preview frames…";
      const form = new FormData();
      form.append("video", videoFile.files[0]);
      form.append("fps", String(fps));
      try {
        const result = await window.API.previewVideo(state.project, form);
        videoSessionId = result.session_id;
        videoFrames = result.frames || [];
        renderVideoFrames();
        videoStatus.textContent = videoFrames.length + " frames ready to review" + (result.truncated ? " (preview capped at the first 500 sampled frames; lower FPS or shorten the video to cover more of it)" : "");
        videoSection.classList.remove("hidden");
        await loadVideoLibrary();
      } catch (error) {
        videoStatus.textContent = "Could not extract frames.";
        U.toast("Video frame extraction failed: " + error.message, "err", 5000);
      } finally {
        button.disabled = false;
        button.textContent = "Extract frames";
      }
    }

    function updateVideoSelection() {
      const selected = videoFrameBox.querySelectorAll("input[data-frame-id]:checked").length;
      const available = videoFrameBox.querySelectorAll("input[data-frame-id]:not(:disabled)").length;
      document.getElementById("ds-video-select-all").disabled = !available;
      document.getElementById("ds-video-clear").disabled = selected === 0;
      const addButton = document.getElementById("ds-video-add");
      addButton.disabled = selected === 0;
      addButton.textContent = selected ? "Add " + selected + " selected frames" : "Add selected frames";
      if (videoLightboxIndex >= 0) {
        const frame = videoFrames[videoLightboxIndex];
        const checkbox = frame && videoFrameBox.querySelector('input[data-frame-id="' + frame.id + '"]');
        const selectButton = document.getElementById("ds-video-frame-select");
        if (frame) selectButton.textContent = frame.imported ? "Already added" : (checkbox && checkbox.checked ? "Deselect frame" : "Select frame");
      }
    }

    async function addSelectedVideoFrames() {
      const frameIds = Array.from(videoFrameBox.querySelectorAll("input[data-frame-id]:checked"))
        .map(function (input) { return input.dataset.frameId; });
      if (!frameIds.length) return;
      const button = document.getElementById("ds-video-add");
      button.disabled = true;
      button.textContent = "Adding frames…";
      try {
        const result = await window.API.importVideoFrames(state.project, videoSessionId, frameIds);
        videoStatus.textContent = "Added " + result.added + " frames. The saved video set remains available so you can choose more later.";
        await openVideoSet(videoSessionId);
        await loadVideoLibrary();
        U.toast("Added " + result.added + " frames to the dataset", "ok");
        await refresh();
      } catch (error) {
        U.toast("Could not add video frames: " + error.message, "err", 5000);
        updateVideoSelection();
      }
    }

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
    document.getElementById("ds-drop-browse").onclick = function () { pickFiles(false); };
    dropZone.onclick = function (event) {
      if (event.target.closest("button")) return;
      pickFiles(false);
    };
    dropZone.onkeydown = function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        pickFiles(false);
      }
    };
    ["dragenter", "dragover"].forEach(function (eventName) {
      dropZone.addEventListener(eventName, function (event) {
        event.preventDefault();
        event.stopPropagation();
        dropZone.classList.add("drag-over");
      });
    });
    ["dragleave", "dragend"].forEach(function (eventName) {
      dropZone.addEventListener(eventName, function (event) {
        event.preventDefault();
        if (!event.relatedTarget || !dropZone.contains(event.relatedTarget)) {
          dropZone.classList.remove("drag-over");
        }
      });
    });
    dropZone.addEventListener("drop", function (event) {
      event.preventDefault();
      event.stopPropagation();
      dropZone.classList.remove("drag-over");
      const files = Array.from(event.dataTransfer.files || []).filter(function (file) {
        return /^image\//i.test(file.type) || /\.(jpe?g|png|bmp|webp)$/i.test(file.name);
      });
      if (!files.length) return U.toast("Drop supported image files to upload", "warn");
      uploadFiles(files);
    });
    document.getElementById("ds-import-folder").onclick = function () {
      pickFiles(true);
    };
    document.getElementById("ds-import-zip").onclick = function () {
      if (!state.project) return U.toast("Select a project first", "warn");
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".zip,application/zip,application/x-zip-compressed";
      input.onchange = async function () {
        const file = input.files && input.files[0];
        if (!file) return;
        const form = new FormData();
        form.append("zip", file);
        try {
          const response = await fetch("/api/projects/" + state.project + "/import", {
            method: "POST", body: form
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || ("HTTP " + response.status));
          U.toast("Imported " + result.added + " images, " + (result.annotated || 0) + " with labels, skipped " + result.skipped, "ok", 5000);
          refresh();
        } catch (e) { U.toast("Import failed: " + e.message, "err"); }
      };
      input.click();
    };

    function pickFiles(folder) {
      if (!state.project) return U.toast("Select a project first", "warn");
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/jpeg,image/png,image/bmp,image/webp,.jpg,.jpeg,.png,.bmp,.webp";
      if (folder) { input.webkitdirectory = true; }
      input.multiple = true;
      input.onchange = async function () {
        const files = [].slice.call(input.files);
        if (!files.length) return;
        uploadFiles(files);
      };
      input.click();
    }

    async function uploadFiles(files) {
      if (!state.project) return U.toast("Select a project first", "warn");
      const names = files.slice(0, 5).map(function (file) { return file.name; });
      const more = files.length > names.length ? "\n…and " + (files.length - names.length) + " more" : "";
      const message = "Upload " + files.length + " image(s) to project '" + state.project + "'?\n\n" +
        names.join("\n") + more;
      if (!window.confirm(message)) return;
      const fd = new FormData();
      files.forEach(function (file) { fd.append("files", file); });
      const browseButton = document.getElementById("ds-drop-browse");
      browseButton.disabled = true;
      try {
        const response = await fetch("/api/projects/" + encodeURIComponent(state.project) + "/import",
          { method: "POST", body: fd });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || ("HTTP " + response.status));
        U.toast("Imported " + result.added + " images, skipped " + result.skipped, "ok", 5000);
        await refresh();
      } catch (e) { U.toast("Import failed: " + e.message, "err"); }
      finally { browseButton.disabled = false; }
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

        const check = document.createElement("button");
        check.className = "card-check";
        check.type = "button";
        check.setAttribute("aria-label", (selected ? "Deselect " : "Select ") + img.filename);
        check.setAttribute("aria-pressed", selected ? "true" : "false");
        check.textContent = selected ? "✓" : "";
        check.onclick = function (event) {
          event.stopPropagation();
          if (state.dataset.selected.has(img.filename)) {
            state.dataset.selected.delete(img.filename);
          } else {
            state.dataset.selected.add(img.filename);
          }
          render();
        };
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

    loadVideoLibrary();
    refresh();
  };
})();
