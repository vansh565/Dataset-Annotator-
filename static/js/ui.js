/* Vertex · UI helpers */
(function () {
  "use strict";

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }

  function el(tag, opts) {
    const n = document.createElement(tag);
    if (opts) {
      for (const k in opts) {
        if (k === "className" || k === "id" ||
            k === "textContent" || k === "value") {
          n[k] = opts[k];
        } else {
          n.setAttribute(k, opts[k]);
        }
      }
    }
    return n;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;",
               '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function toast(msg, kind, ms) {
    const box = document.getElementById("toasts");
    if (!box) { console.log("[toast]", kind || "info", msg); return; }
    const t = document.createElement("div");
    t.className = "toast " + (kind || "info");
    t.textContent = String(msg);
    box.appendChild(t);
    setTimeout(function () { t.remove(); },
      ms === undefined ? 2600 : ms);
  }

  function fmtBytes(n) {
    if (n === undefined || n === null) return "—";
    const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return n.toFixed(n < 10 && i > 0 ? 1 : 0) + " " + u[i];
  }

  window.UI = {
    $: $, $$: $$,
    el: el,
    escapeHtml: escapeHtml,
    toast: toast,
    fmtBytes: fmtBytes
  };
})();