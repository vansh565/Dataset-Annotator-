/* Vertex · Tools */
(function () {
  "use strict";

  function nowId() {
    return "a" + Math.random().toString(36).slice(2, 9);
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  class BoxTool {
    constructor() {
      this.state = "idle";
      this.preview = null;
      this.start = null;
      this.dragTarget = null;
      this.orig = null;
      this.canvas = null;
    }
    onDown(ev) {
      const c = this.canvas;
      if (this.state !== "idle") return;
      const hit = c._hitTest(ev.px, ev.py);
      if (hit) {
        c.setSelected(hit.id);
        if (hit.part === "body" || hit.part.indexOf("h") === 0) c.onEditStart();
        this.state = hit.part === "body" ? "moving" : "resizing";
        this.dragTarget = hit;
        this.orig = JSON.parse(JSON.stringify(c.getSelected()));
        this.start = { nx: ev.nx, ny: ev.ny };
      } else {
        c.onEditStart();
        this.state = "drawing";
        this.start = { nx: ev.nx, ny: ev.ny };
        this.preview = { kind: "box", x1: ev.nx, y1: ev.ny,
                          x2: ev.nx, y2: ev.ny };
      }
    }
    onMove(ev) {
      const c = this.canvas;
      if (this.state === "drawing") {
        this.preview.x2 = ev.nx;
        this.preview.y2 = ev.ny;
      } else if (this.state === "moving") {
        const a = c.getSelected(); if (!a) return;
        const dx = ev.nx - this.start.nx;
        const dy = ev.ny - this.start.ny;
        a.x = clamp(this.orig.x + dx, -a.w + 0.001, 1 - 0.001);
        a.y = clamp(this.orig.y + dy, -a.h + 0.001, 1 - 0.001);
      } else if (this.state === "resizing") {
        const a = c.getSelected(); if (!a) return;
        const part = this.dragTarget.part;
        let x1 = this.orig.x, y1 = this.orig.y;
        let x2 = this.orig.x + this.orig.w;
        let y2 = this.orig.y + this.orig.h;
        if (part === "h0") { x1 = ev.nx; y1 = ev.ny; }
        if (part === "h1") { x2 = ev.nx; y1 = ev.ny; }
        if (part === "h2") { x1 = ev.nx; y2 = ev.ny; }
        if (part === "h3") { x2 = ev.nx; y2 = ev.ny; }
        a.x = Math.min(x1, x2);
        a.y = Math.min(y1, y2);
        a.w = Math.abs(x2 - x1);
        a.h = Math.abs(y2 - y1);
      }
    }
    onUp() {
      const c = this.canvas;
      if (this.state === "drawing") {
        const p = this.preview;
        const x = Math.min(p.x1, p.x2);
        const y = Math.min(p.y1, p.y2);
        const w = Math.abs(p.x2 - p.x1);
        const h = Math.abs(p.y2 - p.y1);
        if (w > 0.005 && h > 0.005) {
          const active = (window.__state && window.__state.activeClassId) || 0;
          const ann = { id: nowId(), type: "box", class_id: active,
                        x: x, y: y, w: w, h: h, confidence: 1.0 };
          c.annotations.push(ann);
          c.setSelected(ann.id);
          c.onChange();
        }
        this.preview = null;
      } else if (this.state === "moving" || this.state === "resizing") {
        c.onChange();
      }
      this.state = "idle";
      this.dragTarget = null;
      this.orig = null;
      this.start = null;
      c.render();
    }
  }

  class PanTool {
    constructor() { this.dragging = false; this.start = null; this.canvas = null; }
    onDown(ev) {
      this.dragging = true;
      this.start = { px: ev.px, py: ev.py,
                     ox: this.canvas.offsetX, oy: this.canvas.offsetY };
    }
    onMove(ev) {
      if (!this.dragging) return;
      const c = this.canvas;
      c.offsetX = this.start.ox + (ev.px - this.start.px);
      c.offsetY = this.start.oy + (ev.py - this.start.py);
    }
    onUp() { this.dragging = false; }
  }

  class SmartSelectTool {
    constructor() {
      this.canvas = null;
      this.state = "idle";
      this.start = null;
      this.preview = null;
    }
    onDown(ev) {
      this.state = "drawing";
      this.start = { nx: ev.nx, ny: ev.ny };
      this.preview = { kind: "box", x1: ev.nx, y1: ev.ny,
                       x2: ev.nx, y2: ev.ny };
    }
    onMove(ev) {
      if (this.state !== "drawing") return;
      this.preview.x2 = ev.nx;
      this.preview.y2 = ev.ny;
    }
    onUp(ev) {
      if (this.state !== "drawing") return;
      const s = this.start;
      const startX = clamp(s.nx, 0, 1);
      const startY = clamp(s.ny, 0, 1);
      const endX = clamp(ev.nx, 0, 1);
      const endY = clamp(ev.ny, 0, 1);
      const x = Math.min(startX, endX);
      const y = Math.min(startY, endY);
      const w = Math.abs(endX - startX);
      const h = Math.abs(endY - startY);
      this.state = "idle";
      this.start = null;
      this.preview = null;
      if (!this.canvas || !this.canvas.onSmartSelect) return;
      if (w > 0.01 && h > 0.01) {
        this.canvas.onSmartSelect({ type: "box", x: x, y: y, w: w, h: h });
      } else {
        this.canvas.onSmartSelect({ type: "point", x: endX, y: endY });
      }
    }
  }

  class PolygonTool {
    constructor() {
      this.points = [];
      this.preview = null;
      this.canvas = null;
    }
    onDown(ev) {
      const c = this.canvas;
      if (!this.points.length) c.onEditStart();
      if (this.points.length >= 3) {
        const first = this.points[0];
        const sp = c.toScreen(first[0], first[1]);
        const dx = sp[0] - ev.px;
        const dy = sp[1] - ev.py;
        if (dx * dx + dy * dy < 100) { this.finish(); return; }
      }
      this.points.push([ev.nx, ev.ny]);
      this.render();
    }
    onMove(ev) {
      if (this.points.length) {
        this.preview = [ev.nx, ev.ny];
        this.render();
      }
    }
    onDbl() { this.finish(); }
    onKey(e) {
      if (e.key === "Escape") {
        this.points = []; this.preview = null; this.render();
      }
      if (e.key === "Backspace") {
        this.points.pop(); this.render();
      }
      if (e.key === "Enter") this.finish();
    }
    finish() {
      const c = this.canvas;
      if (this.points.length < 3) {
        this.points = []; this.preview = null; c.render(); return;
      }
      const active = (window.__state && window.__state.activeClassId) || 0;
      const ann = { id: nowId(), type: "polygon", class_id: active,
                    points: this.points.slice(), confidence: 1.0 };
      c.annotations.push(ann);
      c.setSelected(ann.id);
      c.onChange();
      this.points = []; this.preview = null;
      c.render();
    }
    render() {
      const c = this.canvas;
      if (!c) return;
      c.render();
      if (!this.points.length) return;
      const ctx = c.ctx;
      ctx.strokeStyle = "#4f8cff";
      ctx.fillStyle = "#4f8cff44";
      ctx.lineWidth = 2;
      ctx.beginPath();
      this.points.forEach(function (pt, i) {
        const s = c.toScreen(pt[0], pt[1]);
        if (i) ctx.lineTo(s[0], s[1]);
        else ctx.moveTo(s[0], s[1]);
      });
      if (this.preview) {
        const s = c.toScreen(this.preview[0], this.preview[1]);
        ctx.lineTo(s[0], s[1]);
      }
      ctx.stroke();
      this.points.forEach(function (pt) {
        const s = c.toScreen(pt[0], pt[1]);
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(s[0], s[1], 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
    }
  }

  class ObbTool {
    constructor() {
      this.state = "idle";
      this.start = null;
      this.preview = null;
      this.canvas = null;
    }
    onDown(ev) {
      if (this.state !== "idle") return;
      const c = this.canvas;
      const hit = c._hitTest(ev.px, ev.py);
      if (hit && hit.part === "body") {
        c.setSelected(hit.id);
        const selected = c.getSelected();
        c.onEditStart();
        this.state = "moving";
        this.start = { nx: ev.nx, ny: ev.ny, cx: selected.cx, cy: selected.cy };
        return;
      }
      c.onEditStart();
      this.state = "drawing";
      this.start = { nx: ev.nx, ny: ev.ny };
      this.preview = { x: ev.nx, y: ev.ny, w: 0, h: 0 };
    }
    onMove(ev) {
      if (this.state === "drawing") {
        this.preview.x = Math.min(this.start.nx, ev.nx);
        this.preview.y = Math.min(this.start.ny, ev.ny);
        this.preview.w = Math.abs(ev.nx - this.start.nx);
        this.preview.h = Math.abs(ev.ny - this.start.ny);
      } else if (this.state === "moving") {
        const a = this.canvas.getSelected();
        if (a) {
          a.cx = clamp(this.start.cx + ev.nx - this.start.nx, 0, 1);
          a.cy = clamp(this.start.cy + ev.ny - this.start.ny, 0, 1);
        }
      }
    }
    onUp() {
      const c = this.canvas;
      if (this.state === "drawing" && this.preview.w > 0.005 && this.preview.h > 0.005) {
        const active = (window.__state && window.__state.activeClassId) || 0;
        const ann = { id: nowId(), type: "obb", class_id: active,
          cx: this.preview.x + this.preview.w / 2,
          cy: this.preview.y + this.preview.h / 2,
          w: this.preview.w, h: this.preview.h, rotation: 0, confidence: 1.0 };
        c.annotations.push(ann);
        c.setSelected(ann.id);
        c.onChange();
      } else if (this.state === "moving") {
        c.onChange();
      }
      this.state = "idle";
      this.start = null;
      this.preview = null;
      c.render();
    }
  }

  window.Tools = {
    BoxTool: BoxTool, PanTool: PanTool, PolygonTool: PolygonTool,
    ObbTool: ObbTool, SmartSelectTool: SmartSelectTool
  };
})();