/* Vertex ? Models page */
(function () {
  "use strict";
  window.Pages = window.Pages || {};
  window.Pages.models = function (host) {
    var U = window.UI;
    var state = window.__state;
    host.innerHTML =
      '<div class="page">' +
        '<div class="page-head">' +
          '<h1 class="page-title">Models</h1>' +
          '<span class="page-sub">Models for the selected project and shared base checkpoints</span>' +
          '<div class="page-actions">' +
            '<button class="btn" id="m-refresh">Refresh</button>' +
          '</div>' +
        '</div>' +
        '<div class="page-body" id="m-body">' +
          '<div class="empty"><h3>Loading?</h3></div>' +
        '</div>' +
      '</div>';
    async function refresh() {
      var body = document.getElementById("m-body");
      if (!state.project) {
        body.innerHTML = '<div class="empty"><h3>Select a project</h3><p>Project trained models are shown after you select a project.</p></div>';
        return;
      }
      try {
        var models = await window.API.models(state.project);
        if (!models.length) {
          body.innerHTML =
            '<div class="empty"><h3>No models</h3>' +
            '<p>Train a model in this project, or use a shared base checkpoint.</p></div>';
          return;
        }
        var html = "";
        for (var i = 0; i < models.length; i++) {
          var m = models[i];
          html +=
            '<div class="card" style="padding:14px;margin-bottom:8px;display:flex;align-items:center;gap:12px">' +
            '<b>' + U.escapeHtml(m.name) + '</b>' +
            '<span class="muted">' + U.escapeHtml(m.description || U.fmtBytes(m.size)) + '</span>' +
            '<div style="flex:1"></div>' +
            (m.kind === "sam" || m.name.toLowerCase().indexOf("sam2") === 0 ?
              '<span class="chip chip-warn">Smart Selection</span>' :
              '<button class="btn mini" data-path="' + U.escapeHtml(m.path) + '">Load</button>') +
            (Number(m.size) > 0 ? '<button class="btn mini danger" data-delete-model="' + U.escapeHtml(m.name) + '">Delete model</button>' : '') +
            '</div>';
        }
        body.innerHTML = html;
        var btns = body.querySelectorAll("[data-path]");
        for (var j = 0; j < btns.length; j++) {
          (function (b) {
            b.onclick = async function () {
              try {
                var r = await fetch("/api/inference/load", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ model_path: b.dataset.path })
                }).then(function (x) { return x.json(); });
                U.toast("Loaded: " + (r.path || "ok"), "ok");
              } catch (e) {
                U.toast("Load failed: " + e.message, "err");
              }
            };
          })(btns[j]);
        }
        var deleteBtns = body.querySelectorAll("[data-delete-model]");
        for (var k = 0; k < deleteBtns.length; k++) {
          (function (b) {
            b.onclick = async function () {
              if (!window.confirm("Delete " + b.dataset.deleteModel + " from the models folder?")) return;
              b.disabled = true;
              try {
                await window.API.deleteModel(b.dataset.deleteModel, state.project);
                U.toast("Deleted model: " + b.dataset.deleteModel, "ok");
                refresh();
              } catch (e) {
                b.disabled = false;
                U.toast("Could not delete model: " + e.message, "err");
              }
            };
          })(deleteBtns[k]);
        }
      } catch (e) {
        body.innerHTML =
          '<div class="empty"><h3>Error</h3><p>' + U.escapeHtml(e.message) + '</p></div>';
      }
    }
    document.getElementById("m-refresh").onclick = refresh;
    refresh();
  };
})();
