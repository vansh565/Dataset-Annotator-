/* Vertex · Canvas renderer + hit-testing.
   Coordinates are normalized [0..1] relative to the image. */
(function () {
  "use strict";

  function nowId() {
    return "a" + Math.random().toString(36).slice(2, 9);
  }

  class AnnotationCanvas {
    constructor(canvas, opts) {
      opts = opts || {};
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.imgEl = null;
      this._pendingImg = null;
      this.zoom = 1;
      this.offsetX = 0;
      this.offsetY = 0;
      this.annotations = [];
      this.classes = [];
      this.selectedId = null;
      this.hoveredId = null;
      this.hoverPoint = null;
      this.onChange = opts.onChange || function () {};
      this.onSelect = opts.onSelect || function () {};
      this.onEditStart = opts.onEditStart || function () {};
      this.onSmartSelect = opts.onSmartSelect || function () {};
      this._tool = null;
      this._dpr = window.devicePixelRatio || 1;

      this._bindEvents();
      this._resize();
      const self = this;
      window.addEventListener("resize", function () { self._resize(); });

      // Watchdog: if we still have no image after 3s but a URL was set,
      // log the failure with the exact URL so it shows in the console.
      setInterval(function () {
        if (self._pendingImg && !self.imgEl) {
          if (self._pendingImg.complete && self._pendingImg.naturalWidth === 0) {
            console.error("[canvas] image stuck/failed:",
              self._pendingImg.src);
          }
        }
      }, 3000);
    }

    // ----------------------------------------------------------
    // Sizing
    // ----------------------------------------------------------
    _resize() {
      const parent = this.canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      const dpr = window.devicePixelRatio || 1;
      this._dpr = dpr;
      this.canvas.width = Math.floor(w * dpr);
      this.canvas.height = Math.floor(h * dpr);
      this.canvas.style.width = w + "px";
      this.canvas.style.height = h + "px";
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (this.imgEl) this._fit();
      this.render();
    }

    // ----------------------------------------------------------
    // Image loading
    // ----------------------------------------------------------
    setImage(url) {
      const self = this;
      if (!url) {
        this.imgEl = null;
        this._pendingImg = null;
        this.render();
        return;
      }

      // Cancel any previous in-flight load
      if (this._pendingImg) {
        this._pendingImg.onload = null;
        this._pendingImg.onerror = null;
      }

      console.log("[canvas] loading:", url);

      const im = new Image();
      this._pendingImg = im;

      im.onload = function () {
        if (im !== self._pendingImg) return; // stale
        console.log("[canvas] loaded:", im.naturalWidth, "x", im.naturalHeight);
        self.imgEl = im;
        self._fit();
        self.render();
        // Layout may have been zero when we constructed; re-check once.
        setTimeout(function () {
          if (im !== self._pendingImg) return;
          self._resize();
          self.render();
        }, 60);
      };
      im.onerror = function (e) {
        console.error("[canvas] FAILED to load:", url, e);
      };
      im.src = url;
    }

    setClasses(classes) {
      this.classes = classes || [];
      this.render();
    }

    setAnnotations(anns) {
      this.annotations = anns || [];
      this.selectedId = null;
      this.hoveredId = null;
      this.hoverPoint = null;
      this.render();
      if (this.onSelect) this.onSelect(this.getSelected());
    }

    setSelected(id) {
      this.selectedId = id;
      this.render();
      if (this.onSelect) this.onSelect(this.getSelected());
    }

    getSelected() {
      for (let i = 0; i < this.annotations.length; i++) {
        if (this.annotations[i].id === this.selectedId)
          return this.annotations[i];
      }
      return null;
    }

    setTool(tool) {
      this._tool = tool;
      if (tool) tool.canvas = this;
    }

    _fit() {
      if (!this.imgEl) return;
      const rect = this.canvas.getBoundingClientRect();
      const iw = this.imgEl.naturalWidth;
      const ih = this.imgEl.naturalHeight;
      if (!iw || !ih) return;
      const sx = rect.width / iw;
      const sy = rect.height / ih;
      this.zoom = Math.min(sx, sy) * 0.96;
      this.offsetX = (rect.width - iw * this.zoom) / 2;
      this.offsetY = (rect.height - ih * this.zoom) / 2;
    }

    toScreen(nx, ny) {
      if (!this.imgEl) return [0, 0];
      const iw = this.imgEl.naturalWidth;
      const ih = this.imgEl.naturalHeight;
      return [this.offsetX + nx * iw * this.zoom,
              this.offsetY + ny * ih * this.zoom];
    }

    toNormalized(px, py) {
      if (!this.imgEl) return [0, 0];
      const iw = this.imgEl.naturalWidth;
      const ih = this.imgEl.naturalHeight;
      return [(px - this.offsetX) / (iw * this.zoom),
              (py - this.offsetY) / (ih * this.zoom)];
    }

    get canvasRect() { return this.canvas.getBoundingClientRect(); }

    // ----------------------------------------------------------
    // Rendering
    // ----------------------------------------------------------
    render() {
      const ctx = this.ctx;
      const dpr = this._dpr || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

      if (!this.imgEl || !this.imgEl.naturalWidth) {
        this._drawPlaceholder();
        return;
      }

      ctx.drawImage(
        this.imgEl,
        this.offsetX, this.offsetY,
        this.imgEl.naturalWidth * this.zoom,
        this.imgEl.naturalHeight * this.zoom
      );

      if (this.hoveredId) {
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.38)";
        ctx.fillRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);
        ctx.restore();
      }

      const self = this;
      this.annotations.forEach(function (a) { self._drawAnn(a); });
      if (this.hoveredId && this.hoverPoint) this._drawHoverGuide();
      this._drawInProgress();
    }

    _drawPlaceholder() {
      const ctx = this.ctx;
      const rect = this.canvas.getBoundingClientRect();
      ctx.save();
      ctx.fillStyle = "#0e1116";
      ctx.fillRect(0, 0, rect.width, rect.height);

      // grid so it's visibly a canvas, not a black void
      ctx.strokeStyle = "#1a1e25";
      ctx.lineWidth = 1;
      for (let x = 0; x < rect.width; x += 40) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, rect.height); ctx.stroke();
      }
      for (let y = 0; y < rect.height; y += 40) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(rect.width, y); ctx.stroke();
      }

      ctx.fillStyle = "#5a6270";
      ctx.font = "14px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const label = this._pendingImg
        ? "loading image… (" + (this._pendingImg.complete ? "no data" : "in flight") + ")"
        : "no image";
      ctx.fillText(label, rect.width / 2, rect.height / 2);
      ctx.restore();
    }

    _classColor(cid) {
      for (let i = 0; i < this.classes.length; i++) {
        if (this.classes[i].id === cid)
          return this.classes[i].color || "#4f8cff";
      }
      return "#4f8cff";
    }

    _className(cid) {
      for (let i = 0; i < this.classes.length; i++) {
        if (this.classes[i].id === cid) return this.classes[i].name;
      }
      return "class " + cid;
    }

    _drawAnn(a) {
      const ctx = this.ctx;
      const selected = a.id === this.selectedId;
      const highlighted = selected || a.id === this.hoveredId;
      const color = this._classColor(a.class_id);

      if (a.type === "box") {
        const p1 = this.toScreen(a.x, a.y);
        const p2 = this.toScreen(a.x + a.w, a.y + a.h);
        ctx.lineWidth = highlighted ? 3 : 2;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.14;
        ctx.fillRect(p1[0], p1[1], p2[0] - p1[0], p2[1] - p1[1]);
        ctx.globalAlpha = 1;
        ctx.strokeRect(p1[0], p1[1], p2[0] - p1[0], p2[1] - p1[1]);
        this._label(a, p1[0], p1[1], color, highlighted);
        if (selected) {
          this._drawHandles([
            [p1[0], p1[1]], [p2[0], p1[1]],
            [p1[0], p2[1]], [p2[0], p2[1]]
          ]);
        }
      } else if (a.type === "polygon") {
        const self = this;
        const pts = a.points.map(function (pt) {
          return self.toScreen(pt[0], pt[1]);
        });
        if (!pts.length) return;
        ctx.beginPath();
        pts.forEach(function (p, i) {
          if (i) ctx.lineTo(p[0], p[1]);
          else ctx.moveTo(p[0], p[1]);
        });
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.14;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = color;
        ctx.lineWidth = highlighted ? 3 : 2;
        ctx.stroke();
        if (selected) {
          pts.forEach(function (p) { self._handle(p[0], p[1]); });
        }
        this._label(a, pts[0][0], pts[0][1], color, highlighted);
      } else if (a.type === "obb") {
        const cx = a.cx * this.imgEl.naturalWidth * this.zoom + this.offsetX;
        const cy = a.cy * this.imgEl.naturalHeight * this.zoom + this.offsetY;
        const w = a.w * this.imgEl.naturalWidth * this.zoom;
        const h = a.h * this.imgEl.naturalHeight * this.zoom;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((a.rotation || 0) * Math.PI / 180);
        ctx.lineWidth = highlighted ? 3 : 2;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.14;
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.globalAlpha = 1;
        ctx.strokeRect(-w / 2, -h / 2, w, h);
        ctx.restore();
        this._label(a, cx - w / 2, cy - h / 2, color, highlighted);
      }
    }

    _label(a, x, y, color, selected) {
      const ctx = this.ctx;
      let text = this._className(a.class_id);
      if (a.confidence !== undefined && a.confidence < 1) {
        text += " " + Math.round(a.confidence * 100) + "%";
      }
      ctx.font = "12px system-ui";
      const w = ctx.measureText(text).width + 10;
      ctx.fillStyle = color;
      ctx.fillRect(x, y - 18, w, 18);
      ctx.fillStyle = "#fff";
      ctx.fillText(text, x + 5, y - 5);
      if (selected) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y - 18, w, 18);
      }
    }

    _handle(x, y) {
      const ctx = this.ctx;
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#4f8cff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    _drawHandles(pts) {
      const self = this;
      pts.forEach(function (p) { self._handle(p[0], p[1]); });
    }

    _drawInProgress() {
      const t = this._tool;
      if (!t || !t.preview) return;
      const p = t.preview;
      if (p.kind === "box") {
        const a = this.toScreen(p.x1, p.y1);
        const b = this.toScreen(p.x2, p.y2);
        this.ctx.setLineDash([5, 4]);
        this.ctx.strokeStyle = "#4f8cff";
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
        this.ctx.setLineDash([]);
      } else if (p.w !== undefined && p.h !== undefined) {
        const a = this.toScreen(p.x, p.y);
        const b = this.toScreen(p.x + p.w, p.y + p.h);
        this.ctx.setLineDash([5, 4]);
        this.ctx.strokeStyle = "#4f8cff";
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
        this.ctx.setLineDash([]);
      }
    }

    _drawHoverGuide() {
      const ctx = this.ctx;
      const rect = this.canvasRect;
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,.6)";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(this.hoverPoint[0], 0); ctx.lineTo(this.hoverPoint[0], rect.height);
      ctx.moveTo(0, this.hoverPoint[1]); ctx.lineTo(rect.width, this.hoverPoint[1]);
      ctx.stroke();
      ctx.restore();
    }

    // ----------------------------------------------------------
    // Events
    // ----------------------------------------------------------
    _bindEvents() {
      const self = this;
      const c = this.canvas;
      c.addEventListener("mousedown", function (e) { self._onDown(e); });
      c.addEventListener("mousemove", function (e) { self._onMove(e); });
      c.addEventListener("mouseup", function (e) { self._onUp(e); });
      c.addEventListener("dblclick", function (e) { self._onDbl(e); });
      c.addEventListener("wheel", function (e) { self._onWheel(e); },
        { passive: false });
      c.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    }

    _local(e) {
      const r = this.canvasRect;
      return [e.clientX - r.left, e.clientY - r.top];
    }

    _hitTest(px, py) {
      for (let i = this.annotations.length - 1; i >= 0; i--) {
        const a = this.annotations[i];
        if (a.type === "box") {
          const p1 = this.toScreen(a.x, a.y);
          const p2 = this.toScreen(a.x + a.w, a.y + a.h);
          const handles = [[p1[0], p1[1]], [p2[0], p1[1]],
                            [p1[0], p2[1]], [p2[0], p2[1]]];
          for (let h = 0; h < handles.length; h++) {
            const dx = px - handles[h][0];
            const dy = py - handles[h][1];
            if (dx * dx + dy * dy < 100)
              return { id: a.id, part: "h" + h };
          }
          if (px >= p1[0] && px <= p2[0] && py >= p1[1] && py <= p2[1])
            return { id: a.id, part: "body" };
        } else if (a.type === "polygon") {
          const self = this;
          const pts = a.points.map(function (pt) {
            return self.toScreen(pt[0], pt[1]);
          });
          for (let h = 0; h < pts.length; h++) {
            const dx = px - pts[h][0];
            const dy = py - pts[h][1];
            if (dx * dx + dy * dy < 100)
              return { id: a.id, part: "p" + h };
          }
          if (this._pointInPoly(px, py, pts))
            return { id: a.id, part: "body" };
        } else if (a.type === "obb") {
          const cx = a.cx * this.imgEl.naturalWidth * this.zoom + this.offsetX;
          const cy = a.cy * this.imgEl.naturalHeight * this.zoom + this.offsetY;
          const w = a.w * this.imgEl.naturalWidth * this.zoom;
          const h = a.h * this.imgEl.naturalHeight * this.zoom;
          if (px >= cx - w / 2 && px <= cx + w / 2 &&
              py >= cy - h / 2 && py <= cy + h / 2)
            return { id: a.id, part: "body" };
        }
      }
      return null;
    }

    _pointInPoly(px, py, pts) {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const xi = pts[i][0], yi = pts[i][1];
        const xj = pts[j][0], yj = pts[j][1];
        const inter = ((yi > py) !== (yj > py)) &&
          (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
        if (inter) inside = !inside;
      }
      return inside;
    }

    _onDown(e) {
      const p = this._local(e);
      const n = this.toNormalized(p[0], p[1]);
      if (this._tool && this._tool.onDown) {
        this._tool.onDown({ px: p[0], py: p[1], nx: n[0], ny: n[1], event: e });
      }
    }

    _onMove(e) {
      const p = this._local(e);
      const n = this.toNormalized(p[0], p[1]);
      const hit = this._hitTest(p[0], p[1]);
      this.hoveredId = hit ? hit.id : null;
      this.hoverPoint = hit ? p : null;
      if (this._tool && this._tool.onMove) {
        this._tool.onMove({ px: p[0], py: p[1], nx: n[0], ny: n[1], event: e });
      }
      this.render();
    }

    _onUp(e) {
      const p = this._local(e);
      const n = this.toNormalized(p[0], p[1]);
      if (this._tool && this._tool.onUp) {
        this._tool.onUp({ px: p[0], py: p[1], nx: n[0], ny: n[1], event: e });
      }
    }

    _onDbl(e) {
      if (this._tool && this._tool.onDbl) this._tool.onDbl(e);
    }

    _onWheel(e) {
      e.preventDefault();
      const p = this._local(e);
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const before = this.toNormalized(p[0], p[1]);
      this.zoom *= factor;
      this.zoom = Math.max(0.05, Math.min(20, this.zoom));
      const after = this.toNormalized(p[0], p[1]);
      if (this.imgEl) {
        this.offsetX += (after[0] - before[0]) * this.imgEl.naturalWidth * this.zoom;
        this.offsetY += (after[1] - before[1]) * this.imgEl.naturalHeight * this.zoom;
      }
      this.render();
    }

    fit() {
      this._fit();
      this.render();
    }

    zoomBy(f) {
      const c = this.canvasRect;
      const before = this.toNormalized(c.width / 2, c.height / 2);
      this.zoom = Math.max(0.05, Math.min(20, this.zoom * f));
      const after = this.toNormalized(c.width / 2, c.height / 2);
      if (this.imgEl) {
        this.offsetX += (after[0] - before[0]) * this.imgEl.naturalWidth * this.zoom;
        this.offsetY += (after[1] - before[1]) * this.imgEl.naturalHeight * this.zoom;
      }
      this.render();
    }
  }

  window.AnnotationCanvas = AnnotationCanvas;
})();
