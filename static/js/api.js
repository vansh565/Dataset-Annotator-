/* Vertex · API client */
(function () {
  "use strict";

  async function req(method, url, body) {
    const opts = { method: method, headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(url, opts);
    if (!r.ok) {
      let msg = String(r.status);
      try {
        const j = await r.json();
        if (j && j.error) msg += " " + j.error;
      } catch (e) { /* not json */ }
      throw new Error(msg);
    }
    if (r.status === 204) return null;
    const ct = r.headers.get("content-type") || "";
    if (ct.indexOf("application/json") === -1) return r.text();
    return r.json();
  }

  window.API = {
    listProjects: function () { return req("GET", "/api/projects"); },
    createProject: function (name, description) {
      return req("POST", "/api/projects",
        { name: name, description: description || "" });
    },
    getProject: function (n) {
      return req("GET", "/api/projects/" + encodeURIComponent(n));
    },
    deleteProject: function (n) {
      return req("DELETE", "/api/projects/" + encodeURIComponent(n));
    },

    getClasses: function (p) {
      return req("GET", "/api/projects/" + p + "/classes");
    },
    saveClasses: function (p, c) {
      return req("PUT", "/api/projects/" + p + "/classes", c);
    },

    listImages: function (p, q, unannotated, reviewed, annotationStatus, datasetSplit) {
      q = q || "";
      unannotated = !!unannotated;
      const usp = new URLSearchParams();
      if (q) usp.set("q", q);
      if (unannotated) usp.set("unannotated", "1");
      if (reviewed !== null && reviewed !== undefined) usp.set("reviewed", reviewed);
      if (annotationStatus) usp.set("annotation_status", annotationStatus);
      if (datasetSplit) usp.set("split", datasetSplit);
      const qs = usp.toString();
      return req("GET", "/api/projects/" + p + "/images" + (qs ? "?" + qs : ""));
    },
    importPaths: function (p, paths) {
      return req("POST", "/api/projects/" + p + "/import", { paths: paths });
    },
    importZip: function (p, zip) {
      return req("POST", "/api/projects/" + p + "/import", { zip: zip });
    },
    deleteImages: function (p, files) {
      return req("DELETE", "/api/projects/" + p + "/images", { files: files });
    },
    setReviewed: function (p, filename, reviewed) {
      return req("POST", "/api/projects/" + p + "/review",
        { filename: filename, reviewed: reviewed });
    },
    setDatasetSplit: function (p, filename, split) {
      return req("POST", "/api/projects/" + p + "/dataset-split",
        { filename: filename, split: split || null });
    },
    stats: function (p) {
      return req("GET", "/api/projects/" + p + "/stats");
    },

    getAnnotations: function (p, f) {
      return req("GET", "/api/projects/" + p + "/annotations/" + encodeURIComponent(f));
    },
    saveAnnotations: function (p, f, anns) {
      return req("PUT",
        "/api/projects/" + p + "/annotations/" + encodeURIComponent(f), anns);
    },

    listVersions: function (p) {
      return req("GET", "/api/projects/" + p + "/versions");
    },
    createVersion: function (p, note, options) {
      return req("POST", "/api/projects/" + p + "/versions", Object.assign({
        note: note || ""
      }, options || {}));
    },
    deleteVersion: function (p, v) {
      return req("DELETE", "/api/projects/" + p + "/versions/" + v);
    },
    exportVersionYolo: function (p, v, split) {
      return req("POST",
        "/api/projects/" + p + "/versions/" + v + "/export/yolo",
        { split: split !== false });
    },
    exportVersionZip: function (p, v) {
      return req("POST",
        "/api/projects/" + p + "/versions/" + v + "/download", {});
    },

    exportYolo: function (p, split, ratios, seed) {
      return req("POST", "/api/projects/" + p + "/export/yolo",
        { split: !!split, ratios: ratios || [0.7, 0.2, 0.1], seed: seed || 42 });
    },
    exportCsv: function (p) {
      return req("POST", "/api/projects/" + p + "/export/csv", {});
    },
    exportCoco: function (p) {
      return req("POST", "/api/projects/" + p + "/export/coco", {});
    },
    exportVoc: function (p) {
      return req("POST", "/api/projects/" + p + "/export/voc", {});
    },
    downloadExport: async function (p, format, options) {
      const response = await fetch("/api/projects/" + encodeURIComponent(p) + "/export/" + format, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options || {})
      });
      if (!response.ok) {
        let message = "HTTP " + response.status;
        try { const error = await response.json(); if (error.error) message = error.error; }
        catch (ignored) { /* response did not contain JSON */ }
        throw new Error(message);
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const match = disposition.match(/filename\*?=(?:UTF-8''|\")?([^\";]+)/i);
      const filename = match ? decodeURIComponent(match[1].replace(/\"/g, "")) : (p + "_" + format);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      return filename;
    },

    device: function () { return req("GET", "/api/device"); },
    models: function () { return req("GET", "/api/models"); },
    warmModel: function (modelPath) {
      return req("POST", "/api/models/warm", { model_path: modelPath });
    },
    autolabel: function (p, payload) {
      return req("POST", "/api/projects/" + p + "/autolabel", payload);
    },
    smartSelect: function (p, payload) {
      return req("POST", "/api/projects/" + p + "/smart-select", payload);
    },

    quality: function (p) { return req("GET", "/api/projects/" + p + "/quality"); },
    advancedStats: function (p) {
      return req("GET", "/api/projects/" + p + "/advanced-stats");
    },
    listTags: function (p) { return req("GET", "/api/projects/" + p + "/tags"); },
    jobs: function () { return req("GET", "/api/jobs"); },

    imageUrl: function (p, f) {
      return "/api/projects/" + p + "/image-file/" + encodeURIComponent(f);
    },
    thumbUrl: function (p, f) {
      return "/api/projects/" + p + "/thumb/" + encodeURIComponent(f);
    }
  };
})();
