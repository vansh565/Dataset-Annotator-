/* Vertex · Local training and evaluation */
(function () {
  "use strict";
  window.Pages = window.Pages || {};

  window.Pages.train = function (host) {
    const U = window.UI;
    const state = window.__state;
    let pollTimer = null;
    let activeJobId = null;

    host.innerHTML = `
      <div class="page train-page">
        <div class="page-head">
          <h1 class="page-title">Train</h1>
          <span class="page-sub">Train and evaluate a local YOLO model</span>
          <div class="page-actions"><button class="btn" id="tr-refresh">Refresh</button></div>
        </div>
        <div class="page-body">
          <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px">
            <section class="card" style="padding:18px">
              <h2 style="margin:0 0 6px">Training setup</h2>
              <p class="muted" style="margin:0 0 16px">Train from an immutable version of annotated images.</p>
              <div style="display:grid;gap:12px">
                <label class="fld">Dataset version<select id="tr-version" class="input"></select></label>
                <label class="fld">Base model
                  <input id="tr-model" class="input" list="tr-model-list" value="yolo11n.pt" placeholder="Model name or .pt path" />
                  <datalist id="tr-model-list"></datalist>
                </label>
                <div class="grid" style="grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">
                  <label class="fld">Epochs<input id="tr-epochs" class="input" type="number" min="1" max="10000" value="100" /></label>
                  <label class="fld">Image size<input id="tr-imgsz" class="input" type="number" min="32" step="32" value="640" /></label>
                  <label class="fld">Batch size<input id="tr-batch" class="input" type="number" min="1" value="16" /></label>
                </div>
                <label class="fld">Device<select id="tr-device" class="input"><option value="">Automatic</option><option value="cpu">CPU</option><option value="0">GPU 0</option></select></label>
                <label class="row"><input type="checkbox" id="tr-split" checked /> Prepare train, validation, and test splits</label>
                <div class="row" style="justify-content:space-between"><span class="muted" id="tr-device-info">Checking compute device…</span><button class="btn primary" id="tr-start">Start training</button></div>
              </div>
            </section>
            <section class="card" style="padding:18px">
              <div class="row" style="justify-content:space-between"><div><h2 style="margin:0 0 6px">Evaluate model</h2><p class="muted" style="margin:0">Measure a saved model against a version split.</p></div></div>
              <div style="display:grid;gap:12px;margin-top:16px">
                <label class="fld">Model file or name<input id="tr-eval-model" class="input" list="tr-model-list" placeholder="Select or enter a .pt model path" /></label>
                <label class="fld">Evaluation split<select id="tr-eval-split" class="input"><option value="val">Validation</option><option value="test">Test</option><option value="train">Train</option></select></label>
                <div class="row" style="justify-content:flex-end"><button class="btn" id="tr-evaluate">Evaluate model</button></div>
                <div id="tr-eval-result" class="empty"><p>Select a version and model to evaluate.</p></div>
              </div>
            </section>
          </div>
          <section class="card" style="padding:18px;margin-top:16px">
            <div class="row" style="justify-content:space-between"><div><h2 style="margin:0 0 6px">Training jobs</h2><p class="muted" style="margin:0">Live status and recent output from this server session.</p></div><button class="btn mini" id="tr-jobs-refresh">Refresh jobs</button></div>
            <div id="tr-jobs" style="margin-top:14px"><div class="muted">Loading jobs…</div></div>
          </section>
        </div>
      </div>`;

    const versionSelect = document.getElementById("tr-version");
    const modelInput = document.getElementById("tr-model");
    const evalModel = document.getElementById("tr-eval-model");

    function stopPolling() {
      if (pollTimer) window.clearInterval(pollTimer);
      pollTimer = null;
    }

    async function loadSetup() {
      if (!state.project) {
        versionSelect.innerHTML = '<option value="">Select a project first</option>';
        document.getElementById("tr-device-info").textContent = "No project selected";
        return;
      }
      const current = versionSelect.value;
      try {
        const versions = await window.API.listVersions(state.project);
        versionSelect.innerHTML = versions.length ? versions.slice().reverse().map(function (v) {
          return '<option value="' + Number(v.id) + '">' + U.escapeHtml(v.name || ("v" + v.id)) +
            ' · ' + Number(v.images || 0) + ' images · ' + Number(v.labels || 0) + ' labels</option>';
        }).join("") : '<option value="">No versions — create one in Versions</option>';
        if (versions.some(function (v) { return String(v.id) === current; })) versionSelect.value = current;
      } catch (e) {
        versionSelect.innerHTML = '<option value="">Could not load versions</option>';
        U.toast("Could not load versions: " + e.message, "err");
      }
      try {
        const models = await window.API.models();
        const eligible = models.filter(function (m) { return m.kind !== "sam"; });
        document.getElementById("tr-model-list").innerHTML = eligible.map(function (m) {
          return '<option value="' + U.escapeHtml(m.path || m.name) + '">' + U.escapeHtml(m.name) + '</option>';
        }).join("");
      } catch (ignored) { /* pretrained model names can still be entered manually */ }
      try {
        const device = await window.API.device();
        document.getElementById("tr-device-info").textContent = "Detected: " + (device.name || device.device || "unknown");
        const deviceSelect = document.getElementById("tr-device");
        if (device.device === "cuda") deviceSelect.value = "0";
      } catch (ignored) {
        document.getElementById("tr-device-info").textContent = "Device detection unavailable";
      }
    }

    function renderJob(job) {
      const status = String(job.status || "unknown");
      const color = status === "done" ? "var(--ok)" : status === "failed" ? "var(--err)" : status === "stopped" ? "var(--muted)" : "var(--accent)";
      const tail = (job.tail || []).slice(-12).join("\n");
      const active = status === "queued" || status === "running";
      return '<article class="card" style="padding:12px;margin-bottom:10px">' +
        '<div class="row" style="gap:10px;flex-wrap:wrap"><b>' + U.escapeHtml(job.project || "Project") + ' · v' + U.escapeHtml(job.version) + '</b>' +
        '<span class="chip" style="color:' + color + '">' + U.escapeHtml(status.toUpperCase()) + '</span>' +
        '<span class="muted">Job ' + U.escapeHtml(job.id || "") + '</span><span class="grow"></span>' +
        (job.best ? '<span class="muted">Best: ' + U.escapeHtml(job.best) + '</span><a class="btn mini" href="/api/jobs/' + encodeURIComponent(job.id) + '/download">Download model</a><button class="btn mini" data-test-model="' + U.escapeHtml(job.best) + '">Test model</button><button class="btn mini danger" data-delete-model="' + U.escapeHtml(job.best.split(/[\\/]/).pop()) + '">Delete model</button>' : "") +
        (active ? '<button class="btn mini danger" data-stop-job="' + U.escapeHtml(job.id) + '">Stop training</button>' : status === "stopping" ? '<button class="btn mini" disabled>Stopping…</button>' : "") + '</div>' +
        (tail ? '<pre style="white-space:pre-wrap;max-height:190px;overflow:auto;margin:10px 0 0;padding:10px;background:var(--bg-0);border-radius:6px;font-size:12px">' + U.escapeHtml(tail) + '</pre>' : "") +
        '</article>';
    }

    async function refreshJobs() {
      const box = document.getElementById("tr-jobs");
      try {
        let jobs = await window.API.jobs();
        jobs = jobs.filter(function (job) { return !state.project || job.project === state.project; });
        if (activeJobId) {
          try {
            const active = await window.API.jobStatus(activeJobId);
            jobs = [active].concat(jobs.filter(function (job) { return job.id !== active.id; }));
            if (active.status === "done" || active.status === "failed" || active.status === "stopped") {
              stopPolling();
              if (active.status === "done") U.toast("Training completed" + (active.best ? ": " + active.best : ""), "ok", 5000);
              else if (active.status === "stopped") U.toast("Training stopped", "warn", 5000);
              else U.toast("Training failed. Check the job log for details.", "err", 5000);
            }
          } catch (ignored) { /* retain the job list if status polling is temporarily unavailable */ }
        }
        box.innerHTML = jobs.length ? jobs.map(renderJob).join("") : '<div class="empty"><h3>No training jobs yet</h3><p>Start training above to see progress here.</p></div>';
        box.querySelectorAll("[data-test-model]").forEach(function (button) {
          button.onclick = function () {
            window.__testModelPath = button.dataset.testModel;
            window.__nav("test-model");
          };
        });
        box.querySelectorAll("[data-delete-model]").forEach(function (button) {
          button.onclick = async function () {
            const modelName = button.dataset.deleteModel;
            if (!window.confirm("Delete " + modelName + " from the models folder?")) return;
            button.disabled = true;
            try {
              await window.API.deleteModel(modelName);
              U.toast("Deleted model: " + modelName, "ok");
              await refreshJobs();
            } catch (error) {
              button.disabled = false;
              U.toast("Could not delete model: " + error.message, "err", 5000);
            }
          };
        });
        box.querySelectorAll("[data-stop-job]").forEach(function (button) {
          button.onclick = async function () {
            const jobId = button.dataset.stopJob;
            button.disabled = true;
            button.textContent = "Stopping…";
            try {
              await window.API.stopTraining(jobId);
              activeJobId = jobId;
              if (!pollTimer) pollTimer = window.setInterval(refreshJobs, 1500);
              await refreshJobs();
            } catch (error) {
              U.toast("Could not stop training: " + error.message, "err", 5000);
              button.disabled = false;
              button.textContent = "Stop training";
            }
          };
        });
      } catch (e) {
        box.innerHTML = '<div class="empty"><h3>Could not load jobs</h3><p>' + U.escapeHtml(e.message) + '</p></div>';
      }
    }

    document.getElementById("tr-start").onclick = async function () {
      if (!state.project) return U.toast("Select a project first", "warn");
      const versionId = Number(versionSelect.value);
      const baseModel = modelInput.value.trim();
      if (!versionId) return U.toast("Create or select a dataset version first", "warn");
      if (!baseModel) return U.toast("Enter a base model or select a local model", "warn");
      const payload = {
        version_id: versionId,
        base_model: baseModel,
        epochs: Number(document.getElementById("tr-epochs").value),
        imgsz: Number(document.getElementById("tr-imgsz").value),
        batch: Number(document.getElementById("tr-batch").value),
        device: document.getElementById("tr-device").value || null,
        split: document.getElementById("tr-split").checked
      };
      if (!payload.epochs || !payload.imgsz || !payload.batch) return U.toast("Training values must be positive numbers", "warn");
      const button = this;
      button.disabled = true;
      button.textContent = "Starting…";
      try {
        const job = await window.API.startTraining(state.project, payload);
        activeJobId = job.id;
        if (job.id) evalModel.value = modelInput.value.trim();
        U.toast("Training job queued", "ok");
        await refreshJobs();
        stopPolling();
        pollTimer = window.setInterval(refreshJobs, 2500);
      } catch (e) {
        U.toast("Could not start training: " + e.message, "err", 5000);
      } finally {
        button.disabled = false;
        button.textContent = "Start training";
      }
    };

    document.getElementById("tr-evaluate").onclick = async function () {
      if (!state.project) return U.toast("Select a project first", "warn");
      if (!versionSelect.value) return U.toast("Create or select a dataset version first", "warn");
      if (!evalModel.value.trim()) return U.toast("Select or enter a trained model path", "warn");
      const button = this;
      const result = document.getElementById("tr-eval-result");
      button.disabled = true;
      button.textContent = "Evaluating…";
      result.innerHTML = '<div class="empty"><h3>Evaluation running…</h3></div>';
      try {
        const report = await window.API.evaluateModel(state.project, {
          version_id: Number(versionSelect.value), model_path: evalModel.value.trim(),
          split: document.getElementById("tr-eval-split").value
        });
        result.className = "card";
        result.style.cssText = "padding:12px";
        result.innerHTML = '<b>Evaluation complete</b><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin-top:10px">' +
          [["mAP50", report.mAP50], ["mAP50–95", report.mAP50_95], ["Precision", report.precision], ["Recall", report.recall]].map(function (item) {
            return '<div class="card" style="padding:10px"><b>' + (Number(item[1] || 0) * 100).toFixed(2) + '%</b><div class="muted">' + item[0] + '</div></div>';
          }).join("") + '</div><p class="muted" style="margin-bottom:0">Report saved to ' + U.escapeHtml(report.report_path || "runs/") + '</p>';
      } catch (e) {
        result.className = "empty";
        result.innerHTML = '<h3>Evaluation failed</h3><p>' + U.escapeHtml(e.message) + '</p>';
      } finally {
        button.disabled = false;
        button.textContent = "Evaluate model";
      }
    };

    document.getElementById("tr-refresh").onclick = function () { loadSetup(); refreshJobs(); };
    document.getElementById("tr-jobs-refresh").onclick = refreshJobs;
    loadSetup();
    refreshJobs();
  };
})();
