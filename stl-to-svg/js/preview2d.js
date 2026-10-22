(function (root) {
  const NS = root.STL2SVG || (root.STL2SVG = {});

  function mount(canvas) {
    const ctx = canvas.getContext("2d");
    const view = { scale: 1, panX: 0, panY: 0, pattern: null, fitted: false };
    const colors = {
      cut: "#d9d0c3",
      keep: "#e7f3f4",
      ink: "#1c1915",
      loose: "#b4532a",
      open: "#9d2c2c",
      muted: "#5c564c"
    };
    let drag = null;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth || 300;
      const h = canvas.clientHeight || 300;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      if (view.pattern && !view.fitted) fit();
      draw();
    }

    function project(p) {
      return { x: p.x * view.scale + view.panX, y: -p.y * view.scale + view.panY };
    }

    function fit() {
      const pattern = view.pattern;
      const w = canvas.clientWidth || 300;
      const h = canvas.clientHeight || 300;
      if (!pattern || !pattern.bounds || pattern.bounds.width === 0) {
        view.scale = 1;
        view.panX = w / 2;
        view.panY = h / 2;
        view.fitted = true;
        return;
      }
      const b = pattern.bounds;
      const pad = 28;
      const s = Math.min((w - pad * 2) / b.width, (h - pad * 2) / b.height);
      view.scale = s;
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      view.panX = w / 2 - cx * s;
      view.panY = h / 2 + cy * s;
      view.fitted = true;
    }

    function draw() {
      const dpr = canvas.width / (canvas.clientWidth || 1);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = canvas.clientWidth || 300;
      const h = canvas.clientHeight || 300;
      ctx.fillStyle = colors.cut;
      ctx.fillRect(0, 0, w, h);
      const pattern = view.pattern;
      if (!pattern || (!pattern.closed.length && !pattern.open.length)) {
        ctx.fillStyle = colors.muted;
        ctx.font = "15px Palatino, Palatino Linotype, serif";
        ctx.fillText("Generate a cutting pattern to see it here.", 18, 32);
        return;
      }
      ctx.beginPath();
      for (const contour of pattern.closed) {
        const p0 = project(contour.pts[0]);
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < contour.pts.length; i++) {
          const p = project(contour.pts[i]);
          ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
      }
      ctx.fillStyle = colors.keep;
      ctx.fill("evenodd");

      function stroke(contours, color, width, dash) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.setLineDash(dash || []);
        ctx.lineJoin = "round";
        ctx.beginPath();
        for (const contour of contours) {
          const p0 = project(contour.pts[0]);
          ctx.moveTo(p0.x, p0.y);
          for (let i = 1; i < contour.pts.length; i++) {
            const p = project(contour.pts[i]);
            ctx.lineTo(p.x, p.y);
          }
          if (contour.closed) ctx.closePath();
        }
        ctx.stroke();
        ctx.restore();
      }

      stroke(pattern.closed.filter((c) => c.role !== "loose"), colors.ink, 1.4);
      stroke(pattern.closed.filter((c) => c.role === "loose"), colors.loose, 2.4);
      stroke(pattern.open, colors.open, 1.6, [5, 4]);

      ctx.fillStyle = colors.loose;
      ctx.font = "12px Segoe UI, sans-serif";
      for (const contour of pattern.closed) {
        if (contour.role !== "loose") continue;
        const p = project(contour.inside);
        ctx.fillText("loose", p.x + 4, p.y);
      }

      const bar = view.scale >= 4 ? 10 : 5;
      const x = 16;
      const y = h - 22;
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + bar * view.scale, y);
      ctx.stroke();
      ctx.fillStyle = colors.ink;
      ctx.font = "12px Segoe UI, sans-serif";
      ctx.fillText(bar + " mm", x, y - 6);
      ctx.fillText(pattern.bounds.width.toFixed(2) + " × " + pattern.bounds.height.toFixed(2) + " mm", x, 20);
    }

    canvas.addEventListener("pointerdown", (event) => {
      canvas.setPointerCapture(event.pointerId);
      drag = { x: event.clientX, y: event.clientY, panX: view.panX, panY: view.panY };
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!drag) return;
      view.panX = drag.panX + (event.clientX - drag.x);
      view.panY = drag.panY + (event.clientY - drag.y);
      draw();
    });
    canvas.addEventListener("pointerup", () => { drag = null; });
    canvas.addEventListener("pointercancel", () => { drag = null; });
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      view.panX = x - (x - view.panX) * factor;
      view.panY = y - (y - view.panY) * factor;
      view.scale *= factor;
      draw();
    }, { passive: false });
    canvas.addEventListener("dblclick", () => { fit(); draw(); });

    return {
      resize,
      setPattern(pattern) {
        view.pattern = pattern;
        view.fitted = false;
        fit();
        draw();
      },
      fit() { fit(); draw(); },
      redraw: draw,
      setPalette(next) {
        Object.assign(colors, next);
        draw();
      }
    };
  }

  NS.preview2d = { mount };
})(typeof window !== "undefined" ? window : globalThis);
