/* Vertex · Classes & Tags page */
(function () {
  "use strict";
  window.Pages = window.Pages || {};

  window.Pages.classes = function (host) {
    const U = window.UI;
    const state = window.__state;
    host.innerHTML = `
      <div class="page classes-page">
        <div class="page-head"><h1 class="page-title">Classes &amp; Tags</h1><span class="page-sub">Manage labels and image groups locally</span></div>
        <div class="classes-tabs"><button class="tab active" data-tab="classes">Classes <b id="class-count">0</b></button><button class="tab" data-tab="tags">Tags <b id="tag-count">0</b></button></div>
        <div class="page-body" id="classes-body"><div class="empty"><h3>Loading…</h3></div></div>
      </div>`;
    let activeTab = "classes";
    let search = "";

    function publishClasses(classes) {
      state.classes = classes || [];
      if (window.__canvas && typeof window.__canvas.setClasses === "function") {
        window.__canvas.setClasses(state.classes);
      }
      if (window.__refreshStatsFooter) window.__refreshStatsFooter();
    }

    async function load() {
      const body = document.getElementById("classes-body");
      if (!state.project) { body.innerHTML = '<div class="empty"><h3>Select a project first</h3></div>'; return; }
      try {
        publishClasses(await window.API.getClasses(state.project));
        const stats = await window.API.stats(state.project);
        const tags = await window.API.listTags(state.project);
        document.getElementById("class-count").textContent = state.classes.length;
        document.getElementById("tag-count").textContent = tags.length;
        body.innerHTML = activeTab === "classes" ? renderClasses(stats) : renderTags(tags);
        bind();
      } catch (e) { body.innerHTML = '<div class="empty"><h3>Could not load classes and tags</h3><p>' + U.escapeHtml(e.message) + '</p><button class="btn" id="classes-retry">Retry</button></div>'; const retry = document.getElementById("classes-retry"); if (retry) retry.onclick = load; }
    }
    function renderClasses(stats) {
      const counts = {};
      (stats.per_class || []).forEach(function (item) { counts[item.id] = item.count; });
      const rows = state.classes.filter(function (item) { return item.name.toLowerCase().indexOf(search.toLowerCase()) !== -1; }).map(function (item) {
        const count = counts[item.id] || 0;
        return '<div class="class-table-row"><span class="class-color" style="background:' + (item.color || "#4f8cff") + '"></span><button class="class-name" data-edit-class="' + item.id + '">' + U.escapeHtml(item.name) + '</button><span class="class-count">' + count.toLocaleString() + '</span><button class="icon-action" title="Delete class" data-delete-class="' + item.id + '">×</button></div>';
      }).join("");
      return '<div class="classes-toolbar"><input id="class-search" class="input" placeholder="Search classes…" value="' + U.escapeHtml(search) + '"><button class="btn primary" id="add-class">+ Add</button><label class="lock-label"><input type="checkbox" id="lock-classes"> Lock classes</label></div><div class="class-table"><div class="class-table-head"><span>COLOR</span><span>CLASS NAME</span><span>COUNT</span><span></span></div>' + (rows || '<div class="empty"><h3>No classes found</h3></div>') + '</div>';
    }
    function renderTags(tags) {
      return '<div class="classes-toolbar"><input id="tag-search" class="input" placeholder="Search tags…"><button class="btn primary" id="add-tag">+ Add tag</button></div><div class="tag-grid">' + (tags.length ? tags.map(function (tag) { return '<button class="tag-card" data-tag="' + U.escapeHtml(tag.tag) + '"><b>' + U.escapeHtml(tag.tag) + '</b><span>' + tag.c + ' images</span></button>'; }).join("") : '<div class="empty"><h3>No tags yet</h3></div>') + '</div>';
    }
    function bind() {
      document.querySelectorAll(".classes-tabs .tab").forEach(function (button) { button.onclick = function () { activeTab = button.dataset.tab; document.querySelectorAll(".classes-tabs .tab").forEach(function (tab) { tab.classList.toggle("active", tab === button); }); load(); }; });
      const searchInput = document.getElementById("class-search");
      if (searchInput) searchInput.oninput = function () { search = searchInput.value; load(); };
      const add = document.getElementById("add-class");
      if (add) add.onclick = async function () {
        const name = (prompt("Class name:") || "").trim();
        if (!name) return;
        if (state.classes.some(function (item) { return item.name.toLowerCase() === name.toLowerCase(); })) return U.toast("That class already exists", "warn");
        const id = state.classes.reduce(function (max, item) { return Math.max(max, Number(item.id) || 0); }, -1) + 1;
        const next = state.classes.concat({ id: id, name: name, color: "hsl(" + ((id * 67) % 360) + ",70%,55%)" });
        try {
          publishClasses(await window.API.saveClasses(state.project, next));
          U.toast("Class added", "ok");
          load();
        } catch (e) { U.toast("Could not add class: " + e.message, "err"); }
      };
      document.querySelectorAll("[data-edit-class]").forEach(function (button) { button.onclick = async function () {
        const item = state.classes.find(function (entry) { return String(entry.id) === button.dataset.editClass; });
        if (!item) return;
        const name = (prompt("Rename class:", item.name) || "").trim();
        if (!name || name === item.name) return;
        if (state.classes.some(function (entry) { return entry !== item && entry.name.toLowerCase() === name.toLowerCase(); })) return U.toast("That class already exists", "warn");
        const previous = item.name;
        item.name = name;
        try {
          publishClasses(await window.API.saveClasses(state.project, state.classes));
          U.toast("Class renamed", "ok");
          load();
        } catch (e) { item.name = previous; U.toast("Could not rename class: " + e.message, "err"); }
      }; });
      document.querySelectorAll("[data-delete-class]").forEach(function (button) { button.onclick = async function () {
        const item = state.classes.find(function (entry) { return String(entry.id) === button.dataset.deleteClass; });
        if (!item || !confirm("Delete class '" + item.name + "'? Existing annotations keep their class ID.")) return;
        const previous = state.classes;
        const next = state.classes.filter(function (entry) { return entry !== item; });
        try {
          publishClasses(await window.API.saveClasses(state.project, next));
          U.toast("Class deleted", "ok");
          load();
        } catch (e) { state.classes = previous; U.toast("Could not delete class: " + e.message, "err"); }
      }; });
      document.querySelectorAll("[data-tag]").forEach(function (button) { button.onclick = function () { U.toast(button.dataset.tag + " has " + button.textContent.split("\n").pop().trim(), "ok"); }; });
    }
    load();
  };
})();
