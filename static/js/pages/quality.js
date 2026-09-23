/* Vertex · Quality page */
(function () {
  "use strict";
  window.Pages = window.Pages || {};

  window.Pages.quality = function (host) {
    const U = window.UI;
    const state = window.__state;
    const checks = [
      ["missing_label", "Missing label files"],
      ["empty_label_file", "Empty label files"],
      ["invalid_yolo_coordinates", "Invalid YOLO coordinates"],
      ["duplicate_image", "Duplicate images"],
      ["corrupted_image", "Corrupted images"],
      ["wrong_class_id", "Wrong class IDs"],
      ["box_outside_image", "Boxes outside image boundaries"],
      ["extremely_small_box", "Extremely small boxes"],
      ["overlapping_boxes", "Overlapping boxes"],
      ["image_without_annotations", "Images with no annotations"],
      ["high_annotation_count", "Unusually high annotation counts"],
      ["near_duplicate_image", "Near-duplicate images"]
    ];

    host.innerHTML = `
      <div class="page">
        <div class="page-head">
          <h1 class="page-title">Quality</h1>
          <span class="page-sub">Dataset validation</span>
          <div class="page-actions">
            <button class="btn primary" id="q-run">Run check</button>
          </div>
        </div>
        <div class="page-body" id="q-body">
          <div class="empty"><h3>Click "Run check"</h3>
          <p>Checks labels, coordinates, classes, boxes, image integrity, duplicates, and annotation counts.</p></div>
        </div>
      </div>`;

    document.getElementById("q-run").onclick = async function () {
      const body = document.getElementById("q-body");
      if (!state.project) return U.toast("Select a project", "warn");
      body.innerHTML = `<div class="empty"><h3>Running…</h3></div>`;
      try {
        const r = await window.API.quality(state.project);
        const counts = {};
        r.issues.forEach(function (issue) { counts[issue.kind] = (counts[issue.kind] || 0) + 1; });
        let html =
          `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr));margin-bottom:16px">` +
          `<div class="card" style="padding:14px"><b style="font-size:22px;color:var(--err)">${r.summary.errors}</b><div class="muted">Errors</div></div>` +
          `<div class="card" style="padding:14px"><b style="font-size:22px;color:var(--warn)">${r.summary.warnings}</b><div class="muted">Warnings</div></div>` +
          `<div class="card" style="padding:14px"><b style="font-size:22px">${r.summary.images_checked || 0}</b><div class="muted">Images checked</div></div>` +
          `<div class="card" style="padding:14px"><b style="font-size:22px">${r.summary.total}</b><div class="muted">Total findings</div></div></div>` +
          `<h3 style="margin:0 0 10px">Checks</h3><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr));margin-bottom:20px">` +
          checks.map(function (check) {
            const count = counts[check[0]] || 0;
            return '<div class="card" style="padding:12px"><b style="font-size:20px;color:' + (count ? "var(--warn)" : "var(--ok)") + '">' + count + '</b><div>' + U.escapeHtml(check[1]) + '</div></div>';
          }).join("") + `</div>`;

        if (!r.issues.length) {
          html += `<div class="empty"><h3>Clean ✓</h3></div>`;
        } else {
          html += `<h3 style="margin:0 0 10px">Findings</h3>` + r.issues.slice(0, 300).map(function (i) {
            const color = i.level === "error" ? "var(--err)" : "var(--warn)";
            const category = checks.find(function (check) { return check[0] === i.kind; });
            const files = i.filename || (i.files || []).join(", ") || "Dataset";
            const detail = [i.line ? "line " + i.line : "", i.lines ? "lines " + i.lines.join(" and ") : "",
              i.class_id !== undefined ? "class ID " + i.class_id : "", i.count !== undefined ? i.count + " annotations" : "",
              i.iou !== undefined ? "IoU " + i.iou : "", i.distance !== undefined ? "hash distance " + i.distance : "",
              i.detail || ""].filter(Boolean).join(" · ");
            return `<div style="padding:6px 10px;border-left:3px solid ${color};` +
              `margin-bottom:6px;background:var(--bg-1);border-radius:6px">` +
              `<b>${i.level.toUpperCase()}</b> · ${U.escapeHtml(category ? category[1] : i.kind)} · ` +
              `${U.escapeHtml(files)}${detail ? '<div class="muted" style="margin-top:3px">' + U.escapeHtml(detail) + '</div>' : ''}</div>`;
          }).join("");
        }
        body.innerHTML = html;
      } catch (e) {
        body.innerHTML =
          `<div class="empty"><h3>Error</h3><p>${U.escapeHtml(e.message)}</p></div>`;
      }
    };
  };
})();
