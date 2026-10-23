(function (root) {
  const NS = root.STL2SVG || (root.STL2SVG = {});

  const $ = (id) => document.getElementById(id);
  const state = {
    raw: null,
    shown: null,
    name: "cutting-pattern",
    basis: null,
    sliceT: 0.5,
    pattern: null,
    undo: null,
    pending: null
  };

  function setStatus(text, kind) {
    const node = $("status");
    node.textContent = text;
    node.className = "status" + (kind ? " " + kind : "");
  }

  function readNumbers() {
    return {
      rx: Number($("rx").value) || 0,
      ry: Number($("ry").value) || 0,
      rz: Number($("rz").value) || 0,
      scale: Math.max(0.001, Number($("scale").value) || 1),
      tolerance: Math.max(0, Number($("tolerance").value) || 0)
    };
  }

  function heightNow() {
    if (!state.shown || !state.basis) return 0;
    const range = NS.geom.rangeAlong(state.shown, state.basis.normal);
    const span = range.max - range.min;
    return { range, span, height: range.min + state.sliceT * span };
  }

  function applyTransform() {
    if (!state.raw) return;
    const n = readNumbers();
    state.shown = NS.geom.transform(state.raw.positions, n.rx, n.ry, n.rz, n.scale);
    view3d.setMesh(state.shown);
    updatePlane();
    const box = NS.geom.boundsOf(state.shown);
    $("size").textContent = "Model " +
      (box.max.x - box.min.x).toFixed(2) + " × " +
      (box.max.y - box.min.y).toFixed(2) + " × " +
      (box.max.z - box.min.z).toFixed(2) + " mm, " +
      state.raw.triangles.toLocaleString() + " triangles";
  }

  function updatePlane() {
    if (!state.shown || !state.basis) return;
    const info = heightNow();
    $("slice").value = String(Math.round(state.sliceT * 1000));
    $("slice-mm").value = info.height.toFixed(3);
    $("thickness").textContent = "Along this view the solid is " + info.span.toFixed(3) + " mm thick. A 1.25 mm ornament is cut through the middle.";
    view3d.setPlane(state.basis, info.height);
  }

  function useMesh(parsed, name) {
    state.raw = parsed;
    state.name = name.replace(/\.stl$/i, "") || "cutting-pattern";
    state.pattern = null;
    state.undo = null;
    state.pending = null;
    state.sliceT = 0.5;
    $("export").disabled = true;
    $("attach").disabled = true;
    $("undo-attach").hidden = true;
    $("attach-warn").hidden = true;
    view2d.setPattern(null);
    $("report").textContent = "";
    applyTransform();
    setStatus("Solid loaded. Set the view, then generate the cutting pattern.", "ok");
  }

  function loadBuffer(buffer, name) {
    try {
      const parsed = NS.parseSTL(buffer);
      if (!parsed.triangles) throw new Error("The STL has no triangles.");
      useMesh(parsed, name);
    } catch (error) {
      setStatus(error.message || "Could not read that STL.", "bad");
    }
  }

  function describe(pattern) {
    const outlines = pattern.closed.filter((c) => c.role === "outline").length;
    const holes = pattern.closed.filter((c) => c.role === "hole").length;
    const loose = pattern.closed.filter((c) => c.role === "loose").length;
    const lines = [];
    const info = heightNow();
    if (pattern.profile) {
      lines.push(
        pattern.bounds.width.toFixed(2) + " × " + pattern.bounds.height.toFixed(2) +
        " mm. Profile from this view, across " + info.span.toFixed(3) + " mm. The outline stays within " +
        (pattern.step || 0).toFixed(2) + " mm of the solid."
      );
    } else {
      lines.push(
        pattern.bounds.width.toFixed(2) + " × " + pattern.bounds.height.toFixed(2) +
        " mm. Slice at " + info.height.toFixed(3) + " mm, inside a span of " + info.span.toFixed(3) + " mm."
      );
    }
    if (!pattern.closed.length) {
      lines.push(pattern.profile
        ? "No outline from this view."
        : "No closed cut at this height. Move the red plane into the solid and generate again.");
    } else {
      lines.push(
        pattern.closed.length + (pattern.closed.length === 1 ? " closed contour: " : " closed contours: ") + outlines + " outside, " +
        holes + (holes === 1 ? " opening, " : " openings, ") +
        loose + (loose === 1 ? " loose piece." : " loose pieces.")
      );
    }
    if (loose) {
      lines.push("A loose piece sits inside a cut. Once that opening is machined, the piece is no longer held. Attach loose pieces joins it at the nearest gap, or draw a box or circle to choose the place.");
    }
    if (pattern.attached) {
      lines.push(
        "Joined " + pattern.attached + " loose " + (pattern.attached === 1 ? "piece" : "pieces") +
        " to the surrounding material. The strip stays, so that part of the opening is closed. " +
        (pattern.profile ? "Profile again to start from this view." : "Generate again to start from the slice.")
      );
    }
    if (pattern.profile && pattern.closed.length) {
      lines.push("A hole in this profile is a place you can see straight through. The slice height was not used.");
    }
    if (pattern.open.length) {
      lines.push(pattern.open.length + (pattern.open.length === 1 ? " open contour is" : " open contours are") + " drawn dashed. Open lines are left out of the SVG.");
    }
    if (pattern.duplicates) {
      lines.push("Removed " + pattern.duplicates + " duplicate line" + (pattern.duplicates === 1 ? "" : "s") + ".");
    }
    if (pattern.overlaps) {
      lines.push(pattern.overlaps + " overlapping line pairs. Those places can be cut twice. Check the preview.");
    }
    if (pattern.overlapSkipped) lines.push("Overlap check was skipped on this very large slice.");
    if (pattern.repaired) {
      lines.push("Joined " + pattern.repaired + " gap" + (pattern.repaired === 1 ? "" : "s") + ". Compare the drawing with the solid before you cut.");
    } else if (pattern.gaps.length) {
      lines.push(pattern.gaps.length + " gap" + (pattern.gaps.length === 1 ? "" : "s") + " within " + pattern.tolerance.toFixed(2) + " mm. Repair is waiting for an answer.");
    }
    if (pattern.nudged) lines.push("The slice moved just inside a flat face, so the cut comes from the walls.");
    return lines.join(" ");
  }

  function showPattern(pattern) {
    state.pattern = pattern;
    NS.current = pattern;
    view2d.setPattern(pattern);
    const text = describe(pattern);
    $("report").textContent = text;
    const ready = pattern.closed.length > 0 && !pattern.open.length && !pattern.gaps.length;
    $("export").disabled = pattern.closed.length === 0;
    $("attach").disabled = pattern.closed.filter((c) => c.role === "loose").length === 0;
    $("undo-attach").hidden = !state.undo;
    setStatus(ready ? "Closed cuts. Ready to export." : text, ready ? "ok" : "bad");
    if (pattern.gaps.length && !pattern.repaired) openRepair(pattern);
  }

  function generate() {
    if (!state.shown) {
      setStatus("Load an STL first.", "bad");
      return;
    }
    const info = heightNow();
    const cut = NS.sliceMesh(state.shown, state.basis, info.height);
    const pattern = NS.contours.analyze(cut.segments, readNumbers().tolerance);
    pattern.nudged = cut.nudged;
    state.undo = null;
    state.pending = null;
    view2d.setDrafts(null);
    $("attach-warn").hidden = true;
    showPattern(pattern);
  }

  function profile() {
    if (!state.shown) {
      setStatus("Load an STL first.", "bad");
      return;
    }
    if (state.busy) return;
    state.busy = true;
    setStatus("Building the profile from this view…", "");
    setTimeout(() => {
      try {
        const info = heightNow();
        const cut = NS.profileMesh(state.shown, state.basis);
        const pattern = NS.contours.analyze(cut.segments, readNumbers().tolerance);
        pattern.profile = true;
        pattern.step = Math.max(cut.step || 0, cut.error || 0);
        pattern.span = info.span;
        state.undo = null;
        state.pending = null;
        view2d.setDrafts(null);
        $("attach-warn").hidden = true;
        showPattern(pattern);
      } catch (error) {
        setStatus(error.message || "Could not build that profile.", "bad");
      }
      state.busy = false;
    }, 30);
  }

  function bridgeWidth() {
    const width = NS.bridge.clampWidth($("bridge").value);
    $("bridge").value = String(Math.round(width * 100) / 100);
    return width;
  }

  function cancelAttach() {
    state.pending = null;
    view2d.setDrafts(null);
    $("attach-warn").hidden = true;
  }

  function openAttach(proposal, kind) {
    state.pending = proposal;
    state.pending.kind = kind;
    const count = proposal.count;
    const piece = count === 1 ? "loose piece" : "loose pieces";
    $("attach-title").textContent = count === 1 ? "Attach this loose piece?" : "Attach these loose pieces?";
    if (kind === "nearest") {
      $("attach-text").textContent = "A strip " + proposal.width.toFixed(2) +
        " mm wide runs from each loose piece to the nearest surrounding material. The strip stays, so the piece remains attached. The opening closes along that strip. A wider strip closes more of the opening.";
    } else {
      const shape = kind === "circle" ? "circle" : "box";
      $("attach-text").textContent = "The " + shape + " you drew stays. It joins " + count + " " + piece +
        " to the rest of the model. The cut changes inside that shape. Where the shape covers an opening, that part of the opening closes.";
    }
    const list = $("attach-list");
    list.replaceChildren();
    (proposal.gaps || []).forEach((gap) => {
      const item = document.createElement("li");
      item.textContent = "Gap of " + gap.distance.toFixed(2) + " mm";
      list.appendChild(item);
    });
    view2d.setDrafts(proposal.bridges);
    $("attach-warn").hidden = false;
    setStatus("Read the question before the cut changes.", "");
  }

  function confirmAttach() {
    const pending = state.pending;
    if (!pending || !state.pattern) {
      cancelAttach();
      return;
    }
    let next = null;
    try {
      next = NS.bridge.apply(state.pattern, pending.bridges);
    } catch (error) {
      next = null;
    }
    cancelAttach();
    if (!next) {
      setStatus("That area did not join the loose piece onto the rest. Draw across the gap so the shape lands on the material that stays.", "bad");
      return;
    }
    state.undo = state.pattern;
    showPattern(next);
  }

  function openRepair(pattern) {
    const list = $("warn-list");
    list.replaceChildren();
    pattern.gaps.forEach((gap) => {
      const item = document.createElement("li");
      item.textContent = gap.distance.toFixed(3) + " mm";
      list.appendChild(item);
    });
    $("warn-text").textContent = "These gaps are within " + pattern.tolerance.toFixed(2) +
      " mm. Joining them closes the outline. If a gap is a real slot in the ornament, joining it removes that opening.";
    $("warn").hidden = false;
  }

  function download() {
    const pattern = state.pattern;
    if (!pattern || !pattern.closed.length) return;
    const svg = NS.buildSVG(pattern, {
      title: state.name,
      note: "Slice " + heightNow().height.toFixed(3) + " mm."
    });
    NS.currentSvg = svg;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = state.name + ".svg";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    setStatus("Saved " + state.name + ".svg. The width on the file is " + pattern.bounds.width.toFixed(2) + " mm.", "ok");
  }

  function askExport() {
    const pattern = state.pattern;
    if (!pattern || !pattern.closed.length) return;
    if (pattern.open.length || pattern.gaps.length) {
      $("export-text").textContent = pattern.open.length
        ? pattern.open.length + " open contour" + (pattern.open.length === 1 ? "" : "s") + " will be left out. The file keeps the " + pattern.closed.length + " closed cuts."
        : "There are still gaps within the repair tolerance. The file keeps the closed cuts only.";
      $("export-warn").hidden = false;
      return;
    }
    download();
  }

  const view3d = NS.preview3d.mount($("view3d"));
  const view2d = NS.preview2d.mount($("view2d"));
  state.basis = NS.geom.preset("top");

  $("file").addEventListener("change", () => {
    const file = $("file").files && $("file").files[0];
    if (!file) return;
    setStatus("Reading the STL…", "");
    const reader = new FileReader();
    reader.onload = () => loadBuffer(reader.result, file.name);
    reader.onerror = () => setStatus("Could not read that file.", "bad");
    reader.readAsArrayBuffer(file);
  });
  $("load").addEventListener("click", () => $("file").click());
  $("sample").addEventListener("click", () => {
    const sample = NS.sampleOrnament();
    $("sample-note").hidden = false;
    $("sample-note").textContent = sample.note;
    state.basis = NS.geom.preset("top");
    useMesh(sample, sample.name);
  });

  ["rx", "ry", "rz", "scale"].forEach((id) => {
    $(id).addEventListener("change", applyTransform);
  });
  $("reset").addEventListener("click", () => {
    $("rx").value = "0";
    $("ry").value = "0";
    $("rz").value = "0";
    $("scale").value = "1";
    state.sliceT = 0.5;
    applyTransform();
  });

  $("slice").addEventListener("input", () => {
    state.sliceT = Number($("slice").value) / 1000;
    updatePlane();
  });
  $("slice-mm").addEventListener("change", () => {
    const info = heightNow();
    const span = info.span || 1;
    const value = Number($("slice-mm").value);
    state.sliceT = Math.max(0, Math.min(1, (value - info.range.min) / span));
    updatePlane();
  });

  function usePreset(name) {
    state.basis = NS.geom.preset(name);
    view3d.setView(name);
    state.sliceT = 0.5;
    updatePlane();
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.view === name ? "true" : "false");
    });
  }
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => usePreset(button.dataset.view));
  });
  $("use-view").addEventListener("click", () => {
    const cam = view3d.getCamera();
    state.basis = NS.geom.basisFromAngles(cam.yaw, cam.pitch);
    state.sliceT = 0.5;
    updatePlane();
    document.querySelectorAll("[data-view]").forEach((button) => button.setAttribute("aria-pressed", "false"));
    setStatus("The red plane now matches the way you are looking. Generate takes a slice there. Profile from this view takes the whole outline.", "ok");
  });
  $("fit3").addEventListener("click", () => view3d.fit());
  $("fit2").addEventListener("click", () => view2d.fit());
  $("generate").addEventListener("click", generate);
  $("profile").addEventListener("click", profile);
  $("export").addEventListener("click", askExport);
  $("attach").addEventListener("click", () => {
    if (!state.pattern) {
      setStatus("Generate a cutting pattern first.", "bad");
      return;
    }
    const proposal = NS.bridge.nearest(state.pattern, bridgeWidth());
    if (!proposal.ok) {
      setStatus(proposal.message, "bad");
      return;
    }
    openAttach(proposal, "nearest");
  });
  function setDrawTool(name) {
    const next = view2d.getTool() === name ? "pan" : name;
    view2d.setTool(next);
    document.querySelectorAll("[data-tool]").forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.tool === next ? "true" : "false");
    });
    if (next === "box") setStatus("Drag a box from the loose piece across the gap onto the material that stays.", "ok");
    else if (next === "circle") setStatus("Drag a circle from its centre. Let the rim reach the material that stays.", "ok");
    else setStatus("Drag the drawing to move it. Scroll to zoom.", "ok");
  }
  $("tool-box").addEventListener("click", () => setDrawTool("box"));
  $("tool-circle").addEventListener("click", () => setDrawTool("circle"));
  view2d.onShape((poly, kind) => {
    if (!state.pattern) {
      setStatus("Generate a cutting pattern first.", "bad");
      return;
    }
    const proposal = NS.bridge.fromShape(state.pattern, poly);
    if (!proposal.ok) {
      view2d.setDrafts(null);
      setStatus(proposal.message, "bad");
      return;
    }
    openAttach(proposal, kind);
  });
  $("attach-go").addEventListener("click", confirmAttach);
  $("attach-cancel").addEventListener("click", cancelAttach);
  $("undo-attach").addEventListener("click", () => {
    if (!state.undo) return;
    const previous = state.undo;
    state.undo = null;
    state.pending = null;
    view2d.setDrafts(null);
    $("attach-warn").hidden = true;
    showPattern(previous);
    setStatus("The last attach is undone.", "ok");
  });

  $("warn-repair").addEventListener("click", () => {
    $("warn").hidden = true;
    if (!state.pattern) return;
    state.undo = null;
    showPattern(NS.contours.repair(state.pattern));
  });
  $("warn-skip").addEventListener("click", () => { $("warn").hidden = true; });
  $("export-go").addEventListener("click", () => { $("export-warn").hidden = true; download(); });
  $("export-cancel").addEventListener("click", () => { $("export-warn").hidden = true; });

  function resize() {
    view3d.resize();
    view2d.resize();
  }
  window.addEventListener("resize", resize);
  if (!view3d.failed && typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(resize);
    observer.observe($("view3d"));
    observer.observe($("view2d"));
  }
  resize();

  function cssColor(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function hexRgb(hex) {
    const h = hex.replace("#", "");
    const n = parseInt(h, 16);
    if (!Number.isFinite(n)) return [0.6, 0.6, 0.6];
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }
  function paintViews() {
    view3d.setPalette({
      paper: hexRgb(cssColor("--paper")),
      mesh: hexRgb(cssColor("--mesh")),
      plane: hexRgb(cssColor("--plane"))
    });
    view2d.setPalette({
      cut: cssColor("--cut"),
      keep: cssColor("--keep"),
      ink: cssColor("--ink"),
      loose: cssColor("--loose"),
      open: cssColor("--open"),
      muted: cssColor("--muted")
    });
  }
  function applyTheme(name) {
    const theme = name === "dark" || name === "summer" || name === "autumn" ? name : "paper";
    if (theme === "paper") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    document.querySelectorAll("[data-theme]").forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.theme === theme ? "true" : "false");
    });
    try { localStorage.setItem("gyg-theme", theme); } catch (e) {}
    paintViews();
  }
  document.querySelectorAll("[data-theme]").forEach((button) => {
    button.addEventListener("click", () => applyTheme(button.dataset.theme));
  });
  applyTheme(document.documentElement.dataset.theme || "paper");

  const floater = $("floater");
  let tipHost = null;
  function hideTip() {
    floater.hidden = true;
    tipHost = null;
  }
  function placeTip(host) {
    const bubble = host && (host.dataset.tip || "");
    if (!bubble.trim()) return;
    const rect = host.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
      hideTip();
      return;
    }
    floater.textContent = bubble.trim();
    floater.hidden = false;
    const margin = 8;
    const width = floater.offsetWidth;
    const height = floater.offsetHeight;
    let left = rect.left;
    if (left + width > window.innerWidth - margin) left = window.innerWidth - width - margin;
    if (left < margin) left = margin;
    let top = rect.bottom + 6;
    if (top + height > window.innerHeight - margin) {
      const above = rect.top - height - 6;
      top = above >= margin ? above : Math.max(margin, window.innerHeight - height - margin);
    }
    floater.style.left = left + "px";
    floater.style.top = top + "px";
    tipHost = host;
  }
  document.addEventListener("pointerover", (event) => {
    const host = event.target.closest && event.target.closest(".ask");
    if (host) placeTip(host);
  });
  document.addEventListener("pointerout", (event) => {
    const host = event.target.closest && event.target.closest(".ask");
    if (!host || host !== tipHost) return;
    const next = event.relatedTarget && event.relatedTarget.closest && event.relatedTarget.closest(".ask");
    if (next === host) return;
    hideTip();
  });
  document.addEventListener("focusin", (event) => {
    const host = event.target.closest && event.target.closest(".ask");
    if (host) placeTip(host);
  });
  document.addEventListener("focusout", (event) => {
    const host = event.target.closest && event.target.closest(".ask");
    if (!host || host.contains(event.relatedTarget)) return;
    hideTip();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideTip();
      if (!$("attach-warn").hidden) cancelAttach();
      if (view2d.getTool() !== "pan") setDrawTool(view2d.getTool());
    }
  });
  window.addEventListener("scroll", () => { if (tipHost) placeTip(tipHost); }, true);
  window.addEventListener("resize", () => { if (tipHost) placeTip(tipHost); });

  if (view3d.failed) setStatus("This browser has no WebGL, so the solid preview is unavailable. Generate and export still run.", "bad");
  else setStatus("Load an STL, or open the sample ornament. Dotted names explain themselves.", "");
})(typeof window !== "undefined" ? window : globalThis);
