/* Vertex · Analytics page */
(function () {
  "use strict";
  window.Pages = window.Pages || {};

  window.Pages.analytics = function (host) {
    const U = window.UI;
    const state = window.__state;
    host.innerHTML = `
      <div class="page analytics-page">
        <div class="page-head"><h1 class="page-title">Dataset Analytics</h1>
          <span class="page-sub">Inspect distribution and prepare balanced local versions</span>
          <div class="page-actions"><button class="btn" id="a-refresh">Regenerate</button><button class="btn primary" id="a-rebalance">Rebalance</button></div>
        </div>
        <div class="page-body" id="a-body"><div class="empty"><h3>Loading…</h3></div></div>
      </div>`;

    function card(value, label, detail) {
      return `<div class="analytics-card"><b>${U.escapeHtml(String(value))}</b><strong>${U.escapeHtml(label)}</strong><span class="muted">${U.escapeHtml(detail || "")}</span></div>`;
    }
    async function load() {
      const body = document.getElementById("a-body");
      if (!state.project) return;
      try {
        state.classes = await window.API.getClasses(state.project);
        const stats = await window.API.stats(state.project);
        const advanced = await window.API.advancedStats(state.project);
        state.analyticsImageCount = stats.total_images || 0;
        const total = Math.max(1, stats.total_annotations || 0);
        body.innerHTML = `<div class="analytics-cards">` +
          card(stats.total_images || 0, "Images", `${stats.annotated_images || 0} annotated`) +
          card(stats.total_annotations || 0, "Annotations", `${stats.total_classes || 0} classes`) +
          card(stats.reviewed_images || 0, "Reviewed", `${stats.unannotated_images || 0} unannotated`) +
          card(advanced.imbalance_ratio ? advanced.imbalance_ratio.toFixed(2) + "×" : "—", "Class imbalance", "rebalance recommended") +
          `</div><section class="analytics-section"><div class="section-head"><h2>Classes</h2><button class="link-btn" id="a-edit-classes">Edit classes</button></div>` +
          (stats.per_class || []).map(function (item) {
            const percent = Math.min(100, item.count / total * 100);
            return `<div class="analytics-bar"><span>${U.escapeHtml(item.name)}</span><div><i style="width:${percent}%;background:${item.color || "#4f8cff"}"></i></div><b>${item.count}</b></div>`;
          }).join("") + `</section>` +
          `<section class="analytics-section"><div class="section-head"><h2>Image insights</h2><span class="muted">${advanced.total_boxes || 0} box annotations analyzed</span></div>` +
          (advanced.resolution_histogram || []).slice(0, 8).map(function (item) {
            return `<div class="insight-row"><span>${item.width || "?"} × ${item.height || "?"}</span><b>${item.c || 0} images</b></div>`;
          }).join("") + `</section>`;
        document.getElementById("a-rebalance").onclick = rebalance;
        document.getElementById("a-refresh").onclick = load;
        document.getElementById("a-edit-classes").onclick = function () { window.__nav("classes"); };
      } catch (e) { body.innerHTML = `<div class="empty"><h3>Analytics failed</h3><p>${U.escapeHtml(e.message)}</p></div>`; }
    }
    function rebalance() {
      const total = state.analyticsImageCount || 0;
      const modal = document.createElement("div");
      modal.className = "modal";
      modal.innerHTML = '<div class="modal-box rebalance-modal"><div class="download-title"><span>⚖</span><h3>Rebalance Splits</h3><button class="link-btn" data-close>×</button></div>' +
        '<div class="rebalance-warning">⚠ After rebalancing, avoid training from a previous checkpoint to prevent dataset bias.</div>' +
        '<div class="rebalance-preview"><div class="rebalance-values"><b id="rb-train-label">70% <em>Train</em><small>0 images</small></b><b id="rb-val-label">20% <em>Valid</em><small>0 images</small></b><b id="rb-test-label">10% <em>Test</em><small>0 images</small></b></div><input id="rb-train" type="range" min="0" max="100" value="70"><input id="rb-val" type="range" min="0" max="100" value="20"></div>' +
        '<label class="fld">Method<select id="rb-method" class="input"><option>Move as few as possible</option><option>Random shuffle</option><option>Stratified by class</option></select></label>' +
        '<label class="fld">Classes to rebalance<select id="rb-class" class="input"><option value="all">All classes</option>' + state.classes.map(function (item) { return '<option value="' + item.id + '">' + U.escapeHtml(item.name) + '</option>'; }).join("") + '</select></label>' +
        '<div class="rebalance-info"><b>What is rebalancing?</b><span>Rebalance your dataset to improve class representation across train, valid, and test splits.</span></div>' +
        '<label class="ack"><input id="rb-ack" type="checkbox"> I understand this creates a new dataset split.</label>' +
        '<div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="rb-submit" disabled>Rebalance Splits</button></div></div>';
      document.body.appendChild(modal);
      const train = modal.querySelector("#rb-train");
      const val = modal.querySelector("#rb-val");
      function update() {
        let trainValue = Number(train.value); let valValue = Number(val.value);
        if (trainValue + valValue > 100) valValue = 100 - trainValue;
        const testValue = 100 - trainValue - valValue; val.value = valValue;
        [["rb-train-label", trainValue, "Train"], ["rb-val-label", valValue, "Valid"], ["rb-test-label", testValue, "Test"]].forEach(function (entry) {
          const label = modal.querySelector("#" + entry[0]); label.firstChild.textContent = entry[1] + "% "; label.querySelector("small").textContent = Math.round(total * entry[1] / 100) + " images";
        });
      }
      train.oninput = update; val.oninput = update; update();
      modal.querySelector("#rb-ack").onchange = function (event) { modal.querySelector("#rb-submit").disabled = !event.target.checked; };
      modal.querySelectorAll("[data-close]").forEach(function (button) { button.onclick = function () { modal.remove(); }; });
      modal.querySelector("#rb-submit").onclick = async function () {
        try {
          const testValue = 100 - Number(train.value) - Number(val.value);
          const version = await window.API.createVersion(state.project, "Rebalanced split", { split: { train: Number(train.value) / 100, val: Number(val.value) / 100, test: testValue / 100 }, preprocessing: [] });
          modal.remove(); U.toast(version.name + " created with the new split", "ok"); window.__nav("versions");
        } catch (e) { U.toast("Rebalance failed: " + e.message, "err"); }
      };
    }
    load();
  };
})();
