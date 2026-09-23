/* Vertex ? Models page */
(function () {
  "use strict";
  window.Pages = window.Pages || {};
  window.Pages.models = function (host) {
    var U = window.UI;
    host.innerHTML =
      '<div class="page">' +
        '<div class="page-head">' +
          '<h1 class="page-title">Models</h1>' +
          '<span class="page-sub">.pt files in ./models/</span>' +
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
      try {
        var models = await window.API.models();
        if (!models.length) {
          body.innerHTML =
            '<div class="empty"><h3>No models</h3>' +
            '<p>Put a .pt file into D:\\annotaion\\models\\ and click Refresh.</p></div>';
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
      } catch (e) {
        body.innerHTML =
          '<div class="empty"><h3>Error</h3><p>' + U.escapeHtml(e.message) + '</p></div>';
      }
    }
    document.getElementById("m-refresh").onclick = refresh;
    refresh();
  };
})();
