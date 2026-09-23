/* ============================================================
   Vertex · app shell + router
   Loaded last. Depends on: api.js, ui.js, canvas.js, tools.js,
   and every module under pages/.
   ============================================================ */
(() => {
  const { $, $$, el, toast } = UI;

  // ----------------------------------------------------------
  // Global state (shared with pages via window.__state)
  // ----------------------------------------------------------
  const state = {
    project: null,
    classes: [],
    images: [],
    currentImage: null,
    activeClassId: 0,
    currentTool: "box",
    currentPage: "dataset",
    dataset: {
      query: "",
      unannotated: false,
      reviewed: null,
      selected: new Set(),
      sort: "name",
      showAnns: true,
    },
  };
  window.__state = state;

  // ----------------------------------------------------------
  // Page router
  // ----------------------------------------------------------
  const PAGE_TITLES = {
    dataset: "Dataset",
    annotate: "Annotate",
    versions: "Versions",
    train: "Train",
    models: "Models",
    analytics: "Analytics",
    quality: "Quality",
    export: "Export",
    settings: "Settings",
    classes: "Classes & Tags",
  };

  function nav(pageName) {
    if (!pageName) pageName = "dataset";
    state.currentPage = pageName;

    // Sidebar highlight
    $$("#nav .nav-item").forEach(n =>
      n.classList.toggle("active", n.dataset.page === pageName)
    );

    const host = $("#page-container");
    const right = $("#right-sidebar");
    const main = $("#main");

    host.innerHTML = "";

    if (pageName === "annotate") {
      main.classList.add("editor");
      right.classList.remove("hidden");
      if (window.Pages.annotate) {
        window.Pages.annotate(host);
      } else {
        host.innerHTML = placeholderHtml("Annotate");
      }
    } else {
      main.classList.remove("editor");
      right.classList.add("hidden");

      if (pageName === "versions" && !window.Pages.versions) {
        const script = document.createElement("script");
        script.src = "/static/js/pages/versions.js?v=2";
        script.onload = function () {
          if (window.Pages.versions) window.Pages.versions(host);
        };
        script.onerror = function () { host.innerHTML = placeholderHtml(pageName); };
        document.head.appendChild(script);
        return;
      }

      const fn = window.Pages && window.Pages[pageName];
      if (fn) {
        fn(host);
      } else {
        host.innerHTML = placeholderHtml(pageName);
      }
    }
  }
  window.__nav = nav;

  function placeholderHtml(pageName) {
    const title = PAGE_TITLES[pageName] || pageName;
    return `
      <div class="page">
        <div class="page-head">
          <h1 class="page-title">${UI.escapeHtml(title)}</h1>
          <span class="page-sub">module not loaded</span>
        </div>
        <div class="page-body">
          <div class="empty">
            <h3>${UI.escapeHtml(title)} page is not available</h3>
            <p>Make sure <code>static/js/pages/${UI.escapeHtml(pageName)}.js</code> is loaded in <code>index.html</code>.</p>
          </div>
        </div>
      </div>`;
  }

  // ----------------------------------------------------------
  // Sidebar wiring
  // ----------------------------------------------------------
  $$("#nav .nav-item").forEach(n => {
    n.addEventListener("click", () => {
      if (n.dataset.page === "annotate") state.currentImage = null;
      nav(n.dataset.page);
    });
  });

  // ----------------------------------------------------------
  // Projects
  // ----------------------------------------------------------
  async function refreshProjects() {
    try {
      const ps = await API.listProjects();
      const sel = $("#project-select");
      if (!sel) return;

      const current = state.project;
      sel.innerHTML = "";

      const opt0 = el("option", { value: "" });
      opt0.textContent = ps.length ? "— Select project —" : "— No projects —";
      sel.appendChild(opt0);

      ps.forEach(p => {
        const o = el("option", { value: p.name });
        o.textContent = p.name;
        sel.appendChild(o);
      });

      if (current && ps.some(p => p.name === current)) {
        sel.value = current;
      }
    } catch (e) {
      toast("Could not list projects: " + e.message, "err");
    }
  }

  async function loadProject(name) {
    if (!name) return;
    state.project = name;

    const statusProject = $("#status-project");
    if (statusProject) statusProject.textContent = name;

    try {
      const meta = await API.getProject(name);
      state.classes = Array.isArray(meta.classes) ? meta.classes : [];

      // Refresh canvas classes if the editor is mounted
      if (window.__canvas && typeof window.__canvas.setClasses === "function") {
        window.__canvas.setClasses(state.classes);
      }

      // If the editor is open, reload the same image with the new project
      if (state.currentImage && window.__loadImageInEditor &&
          typeof window.__loadImageInEditor === "function") {
        window.__loadImageInEditor(state.currentImage);
      }

      // Re-route so the current page re-renders against the new project
      nav(state.currentPage === "annotate" && state.currentImage
        ? "annotate"
        : "dataset");

      refreshStatsFooter();
    } catch (e) {
      toast("Failed to load project: " + e.message, "err");
    }
  }
  window.__loadProject = loadProject;

  const projectSelect = $("#project-select");
  if (projectSelect) {
    projectSelect.addEventListener("change", e => {
      if (e.target.value) loadProject(e.target.value);
    });
  }

  // New project modal
  const btnNew = $("#btn-new-project");
  if (btnNew) {
    btnNew.addEventListener("click", () => {
      $("#modal-new-project").classList.remove("hidden");
      setTimeout(() => $("#np-name")?.focus(), 0);
    });
  }
  const npCancel = $("#np-cancel");
  if (npCancel) {
    npCancel.addEventListener("click", () =>
      $("#modal-new-project").classList.add("hidden")
    );
  }
  const npCreate = $("#np-create");
  if (npCreate) {
    npCreate.addEventListener("click", async () => {
      const name = ($("#np-name").value || "").trim();
      const desc = ($("#np-desc").value || "").trim();
      if (!name) {
        toast("Project name is required", "warn");
        return;
      }
      try {
        await API.createProject(name, desc);
        $("#modal-new-project").classList.add("hidden");
        $("#np-name").value = "";
        $("#np-desc").value = "";
        await refreshProjects();
        $("#project-select").value = name;
        await loadProject(name);
        toast(`Project "${name}" created`, "ok");
      } catch (e) {
        toast(e.message, "err");
      }
    });
  }

  // Close modal on ESC
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      const modal = $("#modal-new-project");
      if (modal && !modal.classList.contains("hidden")) {
        modal.classList.add("hidden");
      }
    }
  });

  // ----------------------------------------------------------
  // Footer stats
  // ----------------------------------------------------------
  async function refreshStatsFooter() {
    if (!state.project) return;
    try {
      const s = await API.stats(state.project);
      const mid = $("#status-middle");
      if (mid) {
        mid.textContent =
          `${s.total_images} images · ` +
          `${s.annotated_images} annotated · ` +
          `${s.total_annotations} annotations · ` +
          `${s.total_classes} classes`;
      }
      const navCount = $("#nav-dataset-count");
      if (navCount) navCount.textContent = s.total_images;
    } catch (e) {
      /* non-fatal */
    }
  }
  window.__refreshStatsFooter = refreshStatsFooter;

  // ----------------------------------------------------------
  // Device chip
  // ----------------------------------------------------------
  (async () => {
    try {
      const d = await API.device();
      const chip = $("#device-info");
      if (chip) {
        chip.innerHTML =
          `<span class="dot"></span>Device: ${UI.escapeHtml(d.name)}`;
      }
    } catch (e) {
      /* device endpoint might not exist on an older backend; ignore */
    }
  })();

  // ----------------------------------------------------------
  // Global keyboard shortcuts (only active when NOT inside
  // an input field, and only when the editor is not handling
  // the same key — the annotate page registers its own handler).
  // ----------------------------------------------------------
  document.addEventListener("keydown", e => {
    const tag = (e.target.tagName || "").toLowerCase();
    const editing = tag === "input" || tag === "textarea" ||
                    tag === "select" || e.target.isContentEditable;
    if (editing) return;

    // Ctrl/Cmd + K — switch project (quick)
    if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      $("#project-select")?.focus();
    }
  });

  // ----------------------------------------------------------
  // Boot sequence
  // ----------------------------------------------------------
  (async function boot() {
    // If API.module missing pieces, fail loudly but don't crash the shell.
    if (!window.API) {
      document.body.innerHTML =
        "<pre style='padding:24px;color:#f5414f'>API module failed to load. " +
        "Check static/js/api.js and reload.</pre>";
      return;
    }

    await refreshProjects();

    let projects = [];
    try { projects = await API.listProjects(); } catch (e) {}

    if (projects.length) {
      // Prefer the last-opened project if it still exists
      const remembered = sessionStorage.getItem("vertex.project");
      const pick = projects.find(p => p.name === remembered) || projects[0];

      $("#project-select").value = pick.name;
      await loadProject(pick.name);

      // Remember the choice for the rest of the session
      document.getElementById("project-select")
        .addEventListener("change", e => {
          if (e.target.value) sessionStorage.setItem("vertex.project", e.target.value);
        });
    } else {
      // No projects yet — show dataset page with empty state
      nav("dataset");
    }

    // Focus the app
    document.body.focus();
  })();

  // ----------------------------------------------------------
  // Public helpers for pages to call back into the shell
  // ----------------------------------------------------------
  window.__vertex = {
    state,
    nav,
    loadProject,
    refreshProjects,
    refreshStatsFooter,
    toast,
  };
})();