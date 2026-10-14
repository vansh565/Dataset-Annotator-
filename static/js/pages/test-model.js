/* Test a trained local YOLO model on an image or video. */
(function () {
  "use strict";
  window.Pages = window.Pages || {};

  window.Pages["test-model"] = function (host) {
    const U = window.UI;
    host.innerHTML = `
      <div class="page">
        <div class="page-head">
          <h1 class="page-title">Test Model</h1>
          <span class="page-sub">Run a trained model on your own images and videos</span>
        </div>
        <div class="page-body">
          <section class="card" style="padding:18px">
            <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;align-items:end">
              <label class="fld">Trained model
                <select id="test-model-choice" class="input"></select>
              </label>
              <label class="fld">Image or video
                <input id="test-model-file" class="input" type="file" accept="image/*,video/*" />
              </label>
              <label class="fld">Confidence <span id="test-conf-value">0.25</span>
                <input id="test-conf" type="range" min="0.01" max="1" step="0.01" value="0.25" style="width:100%" />
              </label>
              <label class="fld">IoU <span id="test-iou-value">0.45</span>
                <input id="test-iou" type="range" min="0.01" max="1" step="0.01" value="0.45" style="width:100%" />
              </label>
            </div>
            <div class="row" style="justify-content:space-between;margin-top:14px;gap:12px;flex-wrap:wrap">
              <span id="test-model-hint" class="muted">Choose a trained .pt checkpoint and an image or video.</span>
              <button id="test-model-run" class="btn primary">Run prediction</button>
            </div>
          </section>
          <section class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;margin-top:16px">
            <article class="card" style="padding:16px;min-height:350px">
              <h2 style="margin:0 0 12px">Preview</h2>
              <div id="test-model-preview" class="empty" style="min-height:280px;display:grid;place-items:center"><p>Predictions will appear here.</p></div>
              <p id="test-model-summary" class="muted" style="margin-bottom:0"></p>
            </article>
            <article class="card" style="padding:16px;min-height:350px">
              <h2 style="margin:0 0 12px">Detections</h2>
              <div id="test-model-detections" class="empty" style="min-height:280px"><p>No predictions yet.</p></div>
            </article>
          </section>
        </div>
      </div>`;

    const select = document.getElementById("test-model-choice");
    const fileInput = document.getElementById("test-model-file");
    const runButton = document.getElementById("test-model-run");
    const hint = document.getElementById("test-model-hint");
    const preview = document.getElementById("test-model-preview");
    const detectionBox = document.getElementById("test-model-detections");
    const params = new URLSearchParams(window.location.search);

    window.API.models().then(function (models) {
      const eligible = models.filter(function (model) {
        return model.name.toLowerCase().endsWith(".pt") &&
          model.kind !== "sam" && model.name.toLowerCase().indexOf("sam") !== 0;
      });
      select.innerHTML = eligible.length ? eligible.map(function (model) {
        return '<option value="' + U.escapeHtml(model.path) + '">' +
          U.escapeHtml(model.name) + (model.size ? " · " + U.fmtBytes(model.size) : "") +
          '</option>';
      }).join("") : '<option value="">No YOLO checkpoints found</option>';
      if (window.__testModelPath || params.get("model")) {
        select.value = window.__testModelPath || params.get("model");
        window.__testModelPath = null;
      }
      if (!eligible.length) hint.textContent = "Train a model first, or add a YOLO .pt checkpoint to the models folder.";
    }).catch(function (error) {
      select.innerHTML = '<option value="">Could not load models</option>';
      hint.textContent = error.message;
    });

    ["conf", "iou"].forEach(function (key) {
      const input = document.getElementById("test-" + key);
      input.oninput = function () {
        document.getElementById("test-" + key + "-value").textContent = Number(input.value).toFixed(2);
      };
    });

    runButton.onclick = async function () {
      if (!select.value) return U.toast("Select a YOLO model first", "warn");
      if (!fileInput.files || !fileInput.files[0]) return U.toast("Choose an image or video first", "warn");
      const form = new FormData();
      form.append("model_path", select.value);
      form.append("file", fileInput.files[0]);
      form.append("conf", document.getElementById("test-conf").value);
      form.append("iou", document.getElementById("test-iou").value);
      runButton.disabled = true;
      runButton.textContent = "Running…";
      hint.textContent = "Processing locally. Video files may take a while.";
      preview.className = "empty";
      preview.innerHTML = "<p>Running prediction…</p>";
      detectionBox.className = "empty";
      detectionBox.innerHTML = "<p>Waiting for predictions…</p>";
      document.getElementById("test-model-summary").textContent = "";
      try {
        const result = await window.API.testModel(form);
        if (result.kind === "image") {
          preview.innerHTML = '<img src="' + result.preview + '" alt="Model prediction" style="display:block;max-width:100%;max-height:65vh;margin:auto;border-radius:8px" />';
          document.getElementById("test-model-summary").textContent = result.width + " × " + result.height + " · " + result.predictions.length + " detections";
          renderDetections(result.predictions);
        } else {
          preview.innerHTML = '<video controls playsinline style="display:block;width:100%;max-height:65vh;border-radius:8px" src="' + result.video_url + '"></video>';
          document.getElementById("test-model-summary").textContent = result.frames + " frames processed · " + result.detections + " total detections";
          detectionBox.className = "empty";
          detectionBox.innerHTML = "<p>Video predictions are drawn on each frame of the preview.</p>";
        }
        hint.textContent = "Prediction complete using " + select.options[select.selectedIndex].text;
      } catch (error) {
        preview.className = "empty";
        preview.innerHTML = '<h3>Prediction failed</h3><p>' + U.escapeHtml(error.message) + '</p>';
        hint.textContent = "Check the selected model and file, then try again.";
      } finally {
        runButton.disabled = false;
        runButton.textContent = "Run prediction";
      }
    };

    function renderDetections(predictions) {
      if (!predictions.length) {
        detectionBox.className = "empty";
        detectionBox.innerHTML = "<p>No objects found. Try lowering the confidence threshold.</p>";
        return;
      }
      detectionBox.className = "list";
      detectionBox.innerHTML = predictions.map(function (item, index) {
        return '<div class="card" style="padding:10px;margin-bottom:8px;display:flex;justify-content:space-between;gap:10px">' +
          '<span><b>' + U.escapeHtml(item.class_name) + '</b><span class="muted"> · #' + (index + 1) + '</span></span>' +
          '<span class="chip">' + (item.confidence * 100).toFixed(1) + '%</span></div>';
      }).join("");
    }
  };
})();
