/* Vertex · Settings page */
(function () {
  "use strict";
  window.Pages = window.Pages || {};

  window.Pages.settings = function (host) {
    const U = window.UI;
    host.innerHTML = `
      <div class="page">
        <div class="page-head">
          <h1 class="page-title">Settings</h1>
        </div>
        <div class="page-body" id="s-body">
          <div class="empty"><h3>Loading…</h3></div>
        </div>
      </div>`;

    (async function () {
      const body = document.getElementById("s-body");
      try {
        const d = await window.API.device();
        body.innerHTML =
          `<div class="card" style="padding:16px;max-width:540px">` +
          `<h3 style="margin:0 0 8px">Compute</h3>` +
          `<p class="muted">Detected device: <b style="color:var(--fg)">` +
          `${U.escapeHtml(d.name)}</b> (${U.escapeHtml(d.device)})</p>` +
          `<p class="muted" style="margin:12px 0 0">` +
          `All processing runs locally. No cloud, no login.</p>` +
          `</div>`;
      } catch (e) {
        body.innerHTML =
          `<div class="empty"><h3>Error</h3><p>${U.escapeHtml(e.message)}</p></div>`;
      }
    })();
  };
})();