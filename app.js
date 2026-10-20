(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var stage = $("stage");
  var glCanvas = $("gl");
  var ovCanvas = $("overlay");
  var fileInput = $("file");

  var program = null;
  var sourceText = "";
  var sourceName = "";
  var simTime = 0;
  var playing = false;
  var speed = 300;
  var showRapids = true;
  var showPaths = true;
  var showStock = true;
  var showRotary = true;
  var nameEdited = false;
  var loadToken = 0;
  var dirty = true;
  var lastNow = 0;

  var cam = {
    mode: "top",
    targetX: 0,
    targetY: 0,
    targetZ: 0,
    viewH: 100,
    yaw: -0.9,
    pitch: 0.62
  };

  var FACES = {
    top: { yaw: -Math.PI / 2, pitch: 1.52 },
    front: { yaw: -Math.PI / 2, pitch: 0 },
    right: { yaw: 0, pitch: 0 },
    back: { yaw: Math.PI / 2, pitch: 0 },
    left: { yaw: Math.PI, pitch: 0 },
    bottom: { yaw: -Math.PI / 2, pitch: -1.52 }
  };

  var renderer = null;
  var colorZ = { min: 0, max: 1 };
  var holes = [];
  var selectedHole = -1;
  var posLock = false;
  var settingsLock = false;
  var shapes = [];
  var selectedShape = -1;
  var drawTool = null;
  var polyPoints = null;
  var polyCursor = null;
  var rubber = null;
  var patchLock = false;
  var toolCheckLock = false;
  var baseText = "";
  var baseProgram = null;
  var baseName = "";
  var sourceIsPatch = false;
  var nextHole = {
    diameter: 3.175,
    depth: 3,
    peck: 1,
    feed: 200,
    spindle: 12000,
    tool: 1,
    through: false
  };

  function setStatus(text) {
    $("status").textContent = text || "";
  }

  function setBusy(on, title, ratio, sub) {
    var box = $("loading");
    box.hidden = !on;
    if (!on) return;
    $("loadTitle").textContent = title || "Working";
    $("loadBar").style.width = Math.max(0, Math.min(100, (ratio || 0) * 100)) + "%";
    $("loadSub").textContent = sub || "";
  }

  function setPressed(id, on) {
    $(id).setAttribute("aria-pressed", on ? "true" : "false");
  }

  function angleNear(a, b) {
    var d = Math.abs(a - b) % (Math.PI * 2);
    if (d > Math.PI) d = Math.PI * 2 - d;
    return d < 0.08;
  }

  function syncFacebar() {
    var bar = $("facebar");
    if (!bar) return;
    bar.hidden = cam.mode !== "iso";
    Object.keys(FACES).forEach(function (name) {
      var face = FACES[name];
      var on = cam.mode === "iso" && angleNear(cam.yaw, face.yaw) && Math.abs(cam.pitch - face.pitch) < 0.08;
      var id = "face" + name.charAt(0).toUpperCase() + name.slice(1);
      setPressed(id, on);
    });
  }

  function enableJob(on) {
    ["play", "prevLift", "nextLift", "scrub", "speed", "percent", "filename", "saveBtn", "nameReset"].forEach(function (id) {
      $(id).disabled = !on;
    });
  }

  function toolName(number) {
    if (!program) return "";
    var tools = program.meta.tools;
    for (var i = 0; i < tools.length; i++) {
      if (tools[i].number === number) return tools[i].name;
    }
    return "";
  }

  function activeToolpath(time) {
    var list = program.meta.toolpaths;
    var cur = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].startTime == null) continue;
      if (list[i].startTime <= time + 1e-6) cur = list[i];
    }
    return cur;
  }

  function currentLineText(sample) {
    if (!sample || !program.n) return "";
    var i = sample.index;
    if (sample.u >= 0.999 && i + 1 < program.n) i += 1;
    var start = program.lineStart[i];
    var end = program.lineEnd[i];
    var raw = sourceText.slice(start, end).replace(/\r?\n$/, "");
    return raw.trim();
  }

  function syncNameFromTime() {
    if (nameEdited || !program) return;
    var pct = program.totalTime > 0 ? (simTime / program.totalTime) * 100 : 0;
    $("filename").value = Makera.redoName(pct);
  }

  function updateReadout() {
    if (!program || !program.n) return;
    var total = program.totalTime;
    var pct = total > 0 ? (simTime / total) * 100 : 0;
    $("percentRead").innerHTML = pct.toFixed(1) + "<span>%</span>";
    if (document.activeElement !== $("percent")) $("percent").value = pct.toFixed(1);
    if (document.activeElement !== $("scrub")) $("scrub").value = String(Math.round(pct * 100));
    $("elapsed").textContent = Makera.formatTime(simTime);
    $("remaining").textContent = Makera.formatTime(Math.max(0, total - simTime));
    var sample = Makera.sampleAt(program, simTime);
    $("posX").textContent = Makera.fmt(sample.x);
    $("posY").textContent = Makera.fmt(sample.y);
    $("posZ").textContent = Makera.fmt(sample.z);
    var tool = program.tool[sample.index];
    var feed = program.feed[sample.index];
    var spindle = program.spindle[sample.index];
    var cmd = program.spindleCmd[sample.index];
    var cool = program.coolant[sample.index];
    var coolName = cool === 7 ? "mist" : cool === 8 ? "flood" : "coolant off";
    var spin = cmd === 5 ? "spindle off" : "S" + Math.round(spindle);
    var name = toolName(tool);
    var feedLabel = feed > 1 ? ("F" + Makera.fmt(feed)) : "F—";
    var angleRead = program.rotary ? "   A" + Makera.fmt(sample.a) : "";
    $("toolRow").textContent = "T" + tool + (name ? "  " + name : "") + "   " + spin + "   " + feedLabel + "   " + coolName + angleRead;
    $("lineRead").textContent = "Line " + program.lineNo[sample.index].toLocaleString("en-US");
    $("gcode").textContent = currentLineText(sample) || " ";
    $("saveBtn").textContent = pct <= 0.05 ? "Save full program" : "Save redo file";
    syncNameFromTime();
    var paths = $("paths").querySelectorAll("button");
    var active = activeToolpath(simTime);
    for (var i = 0; i < paths.length; i++) {
      paths[i].classList.toggle("active", active && paths[i].dataset.number === String(active.number));
    }
    $("scrub").setAttribute("aria-valuetext", pct.toFixed(1) + " percent");
  }

  function shapeCaption(tool, flat) {
    var kind = (tool.type || tool.name || "tool").replace(/\s+/g, " ");
    var preview = flat
      ? "Preview of the finishing passes, not a measurement."
      : "Preview of the last pass, not a measurement.";
    if (tool.halfAngle > 0 && tool.tipDiameter > 0) {
      return "Finished shape · T" + tool.number + " " + kind + " · " + Makera.fmt(tool.tipDiameter) + " mm tip · " + Makera.fmt(tool.halfAngle * 2) + "° included. " + preview;
    }
    if (tool.diameter > 0) {
      return "Finished shape · T" + tool.number + " " + kind + " · " + Makera.fmt(tool.diameter) + " mm from the file. " + preview;
    }
    return flat
      ? "Finished shape follows the finishing passes. That tool has no size in the file, so this is the path itself, not a measured part."
      : "Finished shape follows the last pass. That tool has no size in the file, so this is the path itself, not a measured part.";
  }

  function activeShape() {
    if (!program) return null;
    if (rotaryOn()) return program._finishShape || null;
    return program._flatShape || null;
  }

  function shapeVisible() {
    var shape = activeShape();
    if (!shape || !shape.count) return false;
    if (rotaryOn()) return true;
    return !!(shape.flat && cam.mode !== "top");
  }

  function updateShapeNote() {
    var el = $("shapeNote");
    if (!el) return;
    var shape = activeShape();
    var show = shapeVisible();
    el.hidden = !show;
    if (show) el.textContent = shapeCaption(shape.tool, !!shape.flat);
  }

  function fillJob(statusText) {
    $("empty").hidden = true;
    $("legend").hidden = false;
    $("jobName").textContent = sourceName;
    var meta = program.meta;
    var facts = [];
    facts.push(program.n.toLocaleString("en-US") + " moves");
    facts.push("path " + Makera.formatTime(program.totalTime));
    if (meta.timeSeconds) facts.push("Makera estimate " + Makera.formatTime(meta.timeSeconds));
    if (meta.material) facts.push(meta.material);
    if (meta.stock && meta.stock.length) {
      var size = meta.stock.length + " × " + meta.stock.width + " × " + meta.stock.height;
      if (meta.stock.diameter > 0) size += " · Ø" + meta.stock.diameter;
      facts.push(size + " " + (meta.unit || "mm"));
    }
    var rotaryBtn = $("rotaryBtn");
    rotaryBtn.hidden = !program.rotary;
    if (!program.rotary) showRotary = false;
    setPressed("rotaryBtn", !!(program.rotary && showRotary));
    updateShapeNote();
    $("jobFacts").textContent = facts.join(" · ");
    $("fileMeta").textContent = sourceName + " · " + program.lineCount.toLocaleString("en-US") + " lines · clearance Z" + Makera.fmt(program.safeZ);
    document.title = sourceName + " · Leny's Makera_NC Editor";
    var list = $("paths");
    list.innerHTML = "";
    jobTargets(program).forEach(function (target) {
      var row = document.createElement("li");
      row.className = "pathrow";
      var box = document.createElement("input");
      box.type = "checkbox";
      box.className = "pathpick";
      box.dataset.id = String(target.id);
      box.dataset.kind = target.kind;
      box.dataset.label = target.name;
      box.setAttribute("aria-label", "Patch " + target.name);
      box.title = "Check this tool to include it when Tools is set to Checked tools.";
      box.addEventListener("change", onToolPick);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.number = String(target.id);
      btn.textContent = target.name;
      btn.disabled = target.startTime == null;
      btn.addEventListener("click", function () {
        if (target.startTime == null) return;
        playing = false;
        paintPlay();
        simTime = target.startTime;
        dirty = true;
        updateReadout();
      });
      row.appendChild(box);
      row.appendChild(btn);
      list.appendChild(row);
    });
    restoreToolChecks();
    colorZ = cutColorRange(program);
    $("zTop").textContent = Makera.fmt(colorZ.max);
    $("zBot").textContent = Makera.fmt(colorZ.min);
    enableJob(true);
    applyThrough();
    nameEdited = false;
    simTime = 0;
    fitView();
    updateReadout();
    setStatus(statusText || "");
  }

  function mat4Multiply(a, b) {
    var o = new Float32Array(16);
    for (var c = 0; c < 4; c++) {
      for (var r = 0; r < 4; r++) {
        o[c * 4 + r] =
          a[r] * b[c * 4] +
          a[4 + r] * b[c * 4 + 1] +
          a[8 + r] * b[c * 4 + 2] +
          a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  }

  function ortho(l, r, b, t, n, f) {
    var m = new Float32Array(16);
    m[0] = 2 / (r - l);
    m[5] = 2 / (t - b);
    m[10] = -2 / (f - n);
    m[12] = -(r + l) / (r - l);
    m[13] = -(t + b) / (t - b);
    m[14] = -(f + n) / (f - n);
    m[15] = 1;
    return m;
  }

  function lookAt(eye, target, up) {
    var zx = eye[0] - target[0];
    var zy = eye[1] - target[1];
    var zz = eye[2] - target[2];
    var zl = Math.hypot(zx, zy, zz) || 1;
    zx /= zl; zy /= zl; zz /= zl;
    var xx = up[1] * zz - up[2] * zy;
    var xy = up[2] * zx - up[0] * zz;
    var xz = up[0] * zy - up[1] * zx;
    var xl = Math.hypot(xx, xy, xz) || 1;
    xx /= xl; xy /= xl; xz /= xl;
    var yx = zy * xz - zz * xy;
    var yy = zz * xx - zx * xz;
    var yz = zx * xy - zy * xx;
    var m = new Float32Array(16);
    m[0] = xx; m[1] = yx; m[2] = zx; m[3] = 0;
    m[4] = xy; m[5] = yy; m[6] = zy; m[7] = 0;
    m[8] = xz; m[9] = yz; m[10] = zz; m[11] = 0;
    m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    m[15] = 1;
    return m;
  }

  function viewSize() {
    var aspect = glCanvas.width / Math.max(1, glCanvas.height);
    var halfH = cam.viewH / 2;
    var halfW = halfH * aspect;
    return { aspect: aspect, halfH: halfH, halfW: halfW };
  }

  function mvpMatrix() {
    var size = viewSize();
    var proj = ortho(-size.halfW, size.halfW, -size.halfH, size.halfH, -4000, 4000);
    if (cam.mode === "top") {
      var view = new Float32Array(16);
      view[0] = 1;
      view[5] = 1;
      view[10] = 1;
      view[12] = -cam.targetX;
      view[13] = -cam.targetY;
      view[15] = 1;
      return mat4Multiply(proj, view);
    }
    var cp = Math.cos(cam.pitch);
    var sp = Math.sin(cam.pitch);
    var cy = Math.cos(cam.yaw);
    var sy = Math.sin(cam.yaw);
    var eye = [
      cam.targetX + cy * cp,
      cam.targetY + sy * cp,
      cam.targetZ + sp
    ];
    var up = Math.abs(sp) > 0.95 ? [-cy * sp, -sy * sp, cp] : [0, 0, 1];
    var view3 = lookAt(eye, [cam.targetX, cam.targetY, cam.targetZ], up);
    return mat4Multiply(proj, view3);
  }

  function project(x, y, z, m) {
    var xh = m[0] * x + m[4] * y + m[8] * z + m[12];
    var yh = m[1] * x + m[5] * y + m[9] * z + m[13];
    var wh = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (!wh) return null;
    return [
      (xh / wh * 0.5 + 0.5) * glCanvas.width,
      (1 - (yh / wh * 0.5 + 0.5)) * glCanvas.height
    ];
  }

  function fitView() {
    if (!program) return;
    var b = program.bounds;
    var stock = stockBox();
    var minX = b.minX;
    var minY = b.minY;
    var maxX = b.maxX;
    var maxY = b.maxY;
    var minZ = b.minZ;
    var maxZ = b.maxZ;
    if (stock) {
      minX = Math.min(minX, stock.x0);
      maxX = Math.max(maxX, stock.x1);
      minY = Math.min(minY, stock.y0);
      maxY = Math.max(maxY, stock.y1);
      minZ = Math.min(minZ, stock.z0);
      maxZ = Math.max(maxZ, stock.z1);
    }
    if (!rotaryOn() && program._flatShape && program._flatShape.count && cam.mode === "iso") {
      var plateTop = stock ? stock.z1 : 0;
      if (maxZ > plateTop) maxZ = plateTop;
    }
    if (rotaryOn()) {
      var axis = rotaryAxis();
      var fitR = axis.radius;
      for (var ri = 0; ri <= program.n; ri++) {
        if (ri < program.n && program.rapid[ri]) continue;
        var rr = Math.hypot(program.y[ri] - axis.y, program.z[ri] - axis.z);
        if (rr > fitR) fitR = rr;
      }
      if (!(fitR > 0)) fitR = 1;
      minY = axis.y - fitR;
      maxY = axis.y + fitR;
      minZ = axis.z - fitR;
      maxZ = axis.z + fitR;
      if (axis.x1 > axis.x0) {
        minX = Math.min(minX, axis.x0);
        maxX = Math.max(maxX, axis.x1);
      }
    }
    cam.targetX = (minX + maxX) / 2;
    cam.targetY = (minY + maxY) / 2;
    cam.targetZ = (minZ + maxZ) / 2;
    var dx = Math.max(1, maxX - minX);
    var dy = Math.max(1, maxY - minY);
    var dz = Math.max(1, maxZ - minZ);
    var aspect = glCanvas.width / Math.max(1, glCanvas.height);
    if (cam.mode === "iso") {
      var span = Math.hypot(dx, dy, dz);
      cam.viewH = Math.max(span * 0.9, span / Math.max(0.2, aspect)) * 1.08;
    } else {
      cam.viewH = Math.max(dy, dx / aspect) * 1.18;
    }
    dirty = true;
  }

  function cutColorRange(prog) {
    if (rotaryOn()) {
      var axis = rotaryAxis();
      var maxR = axis.radius;
      for (var r = 0; r <= prog.n; r++) {
        if (r < prog.n && prog.rapid[r]) continue;
        var rad = Math.hypot(prog.y[r] - axis.y, prog.z[r] - axis.z);
        if (rad > maxR) maxR = rad;
      }
      if (!(maxR > 0)) maxR = 1;
      return { min: axis.z - maxR, max: axis.z + maxR };
    }
    var min = Infinity;
    var max = -Infinity;
    for (var i = 0; i < prog.n; i++) {
      if (prog.rapid[i]) continue;
      var z0 = prog.z[i];
      var z1 = prog.z[i + 1];
      if (z0 < min) min = z0;
      if (z1 < min) min = z1;
      if (z0 > max) max = z0;
      if (z1 > max) max = z1;
    }
    if (!isFinite(min)) {
      min = prog.bounds.minZ;
      max = prog.bounds.maxZ;
    }
    if (max - min < 0.2) {
      min -= 0.5;
      max += 0.5;
    }
    return { min: min, max: max };
  }

  function stockBox() {
    if (!program || !program.meta.stock || !program.meta.origin) return null;
    var s = program.meta.stock;
    var o = program.meta.origin;
    if (!(s.length > 0) || !(s.width > 0) || !(s.height > 0)) return null;
    // Makera's origin x/y/z is the work zero inside a block centered at 0,0,0.
    // topFrontLeft on a 100 x 100 x 5 plate is (-50, -50, 2.5), so in the
    // toolpath the plate runs X 0–100, Y 0–100, and Z 0 down to -5.
    var hx = s.length / 2;
    var hy = s.width / 2;
    var hz = s.height / 2;
    return {
      x0: -hx - o.x,
      x1: hx - o.x,
      y0: -hy - o.y,
      y1: hy - o.y,
      z0: -hz - o.z,
      z1: hz - o.z
    };
  }

  function rotaryOn() {
    return !!(showRotary && program && program.rotary && program.a);
  }

  function rotaryAxis() {
    var box = stockBox();
    var stock = program && program.meta.stock;
    var radius = stock && stock.diameter > 0 ? stock.diameter / 2 : 0;
    if (box) {
      if (!(radius > 0)) radius = Math.min(box.y1 - box.y0, box.z1 - box.z0) / 2;
      return {
        y: (box.y0 + box.y1) / 2,
        z: (box.z0 + box.z1) / 2,
        x0: box.x0,
        x1: box.x1,
        radius: radius
      };
    }
    var b = program.bounds;
    return { y: 0, z: 0, x0: b.minX, x1: b.maxX, radius: radius };
  }

  function wrapInto(buf, o, x, y, z, aDeg, axis) {
    if (!axis) {
      buf[o] = x;
      buf[o + 1] = y;
      buf[o + 2] = z;
      return;
    }
    var dy = y - axis.y;
    var dz = z - axis.z;
    var radius = Math.hypot(dy, dz);
    var ang = Math.atan2(dy, dz) + (aDeg || 0) * 0.017453292519943295;
    buf[o] = x;
    buf[o + 1] = axis.y + radius * Math.sin(ang);
    buf[o + 2] = axis.z + radius * Math.cos(ang);
  }

  function spinWorld(p, spin, axis) {
    if (!spin || !axis) return p;
    var y = p[1] - axis.y;
    var z = p[2] - axis.z;
    var c = Math.cos(spin);
    var s = Math.sin(spin);
    return [p[0], axis.y + c * y - s * z, axis.z + s * y + c * z];
  }

  function displayPoint(x, y, z, aDeg) {
    if (!rotaryOn()) return [x, y, z];
    var scratch = [0, 0, 0];
    wrapInto(scratch, 0, x, y, z, aDeg, rotaryAxis());
    return scratch;
  }

  function segmentSteps(a0, a1, wrap) {
    if (!wrap) return 1;
    var sweep = Math.abs(a1 - a0);
    if (sweep <= 12) return 1;
    var steps = Math.ceil(sweep / 12);
    return steps > 60 ? 60 : steps;
  }

  function surfaceZ() {
    var stock = stockBox();
    return stock ? stock.z1 : 0;
  }

  function copySettings(src) {
    return {
      diameter: Number(src.diameter),
      depth: Number(src.depth),
      peck: Number(src.peck),
      feed: Number(src.feed),
      spindle: Number(src.spindle),
      tool: Number(src.tool),
      through: !!src.through
    };
  }

  function copyThread(src) {
    return {
      name: src.name,
      preset: src.preset,
      major: Number(src.major),
      pitch: Number(src.pitch),
      pilot: Number(src.pilot),
      depth: Number(src.depth),
      millDia: Number(src.millDia),
      feed: Number(src.feed),
      spindle: Number(src.spindle),
      tool: Number(src.tool)
    };
  }

  function plateDepth() {
    var height = program && program.meta.stock && program.meta.stock.height;
    return height > 0 ? Number(height) + 0.5 : null;
  }

  var plainDrillSizes = [1, 2, 3, 3.175, 4, 6];

  function drillSizeChoices() {
    var items = plainDrillSizes.map(function (dia) {
      return { diameter: dia, threads: [] };
    });
    Makera.threads.forEach(function (thread) {
      var found = null;
      for (var i = 0; i < items.length; i++) {
        if (Math.abs(items[i].diameter - thread.pilot) < 0.0005) {
          found = items[i];
          break;
        }
      }
      if (found) {
        found.diameter = thread.pilot;
        found.threads.push(thread);
      } else {
        items.push({ diameter: thread.pilot, threads: [thread] });
      }
    });
    items.sort(function (a, b) { return a.diameter - b.diameter; });
    return items;
  }

  function fillDrillSizes() {
    var sel = $("drillSize");
    sel.innerHTML = "";
    drillSizeChoices().forEach(function (item) {
      var opt = document.createElement("option");
      opt.value = Makera.fmt(item.diameter);
      opt.textContent = Makera.fmt(item.diameter) + " mm" + (item.threads.length ? " · " + item.threads.map(function (thread) { return thread.id; }).join(", ") : "");
      sel.appendChild(opt);
    });
    var custom = document.createElement("option");
    custom.value = "custom";
    custom.textContent = "Custom";
    sel.appendChild(custom);
    syncSizeSelect();
  }

  function syncSizeSelect() {
    var dia = Number($("drillDia").value);
    var best = null;
    var bestGap = 0.0005;
    var options = $("drillSize").options;
    for (var i = 0; i < options.length; i++) {
      if (options[i].value === "custom") continue;
      var gap = Math.abs(Number(options[i].value) - dia);
      if (gap < bestGap) {
        best = options[i].value;
        bestGap = gap;
      }
    }
    $("drillSize").value = best || "custom";
  }

  function readSettings(fallback) {
    var base = fallback || nextHole;
    function take(id, key, min) {
      var n = Number($(id).value);
      if (!isFinite(n) || n < min) return base[key];
      return n;
    }
    var through = $("drillThrough").checked;
    var depth = take("drillDepth", "depth", 0.001);
    var plate = plateDepth();
    if (through && plate != null) depth = plate;
    return {
      diameter: take("drillDia", "diameter", 0.001),
      depth: depth,
      peck: take("drillPeck", "peck", 0.001),
      feed: take("drillFeed", "feed", 0.001),
      spindle: take("drillSpindle", "spindle", 1),
      tool: Math.round(take("drillTool", "tool", 1)),
      through: through
    };
  }

  function loadSettings(src) {
    settingsLock = true;
    $("drillDia").value = src.diameter;
    syncSizeSelect();
    $("drillDepth").value = src.depth;
    $("drillPeck").value = src.peck;
    $("drillFeed").value = src.feed;
    $("drillSpindle").value = src.spindle;
    $("drillTool").value = src.tool;
    $("drillThrough").checked = !!src.through;
    var plate = plateDepth();
    var on = !!src.through && plate != null;
    $("drillDepth").disabled = on;
    if (on) $("drillDepth").value = Makera.fmt(plate);
    settingsLock = false;
  }

  function holeRowHtml(h, i) {
    var dia = isFinite(h.diameter) ? Makera.fmt(h.diameter) + " mm" : "";
    var thread = h.thread ? " · " + (h.thread.name || "thread") : "";
    return "<span>" + (i + 1) + " · " + dia + thread + "</span><span>X" + Makera.fmt(h.x) + "  Y" + Makera.fmt(h.y) + "</span>";
  }

  function paintHoleRow(i) {
    var row = $("holeList").querySelectorAll("button")[i];
    var h = holes[i];
    if (row && h) row.innerHTML = holeRowHtml(h, i);
  }

  function commitSettings() {
    if (settingsLock) return;
    var h = holes[selectedHole];
    if (!h) return;
    var settings = readSettings(h);
    h.diameter = settings.diameter;
    h.depth = settings.depth;
    h.peck = settings.peck;
    h.feed = settings.feed;
    h.spindle = settings.spindle;
    h.tool = settings.tool;
    h.through = settings.through;
    nextHole = copySettings(h);
    paintHoleRow(selectedHole);
    dirty = true;
  }

  function drillSpec() {
    var stock = program && program.meta.stock;
    var origin = program && program.meta.origin;
    var surface = surfaceZ();
    var clearance = program && program.safeZ > surface ? program.safeZ : surface + 15;
    if (holes[selectedHole]) commitSettings();
    return {
      holes: holes.map(function (h) {
        return {
          x: h.x,
          y: h.y,
          diameter: h.diameter,
          depth: h.depth,
          peck: h.peck,
          feed: h.feed,
          spindle: h.spindle,
          tool: h.tool,
          thread: h.thread ? {
            name: h.thread.name,
            preset: h.thread.preset,
            major: h.thread.major,
            pitch: h.thread.pitch,
            pilot: h.thread.pilot,
            depth: h.thread.depth,
            millDia: h.thread.millDia,
            feed: h.thread.feed,
            spindle: h.thread.spindle,
            tool: h.thread.tool
          } : null
        };
      }),
      surface: surface,
      clearance: clearance,
      stock: stock,
      origin: origin,
      sourceName: sourceName
    };
  }

  function renderHoleList() {
    var list = $("holeList");
    list.innerHTML = "";
    holes.forEach(function (h, i) {
      var item = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = i === selectedHole ? "on" : "";
      btn.innerHTML = holeRowHtml(h, i);
      btn.addEventListener("click", function () {
        selectedHole = i;
        renderHoleList();
        dirty = true;
      });
      item.appendChild(btn);
      list.appendChild(item);
    });
    var none = holes.length === 0;
    $("holeClear").disabled = none;
    $("drillSave").disabled = none;
    syncPositionEditors();
  }

  function workSpan() {
    var stock = stockBox();
    var span;
    if (stock) {
      span = { minX: stock.x0, maxX: stock.x1, minY: stock.y0, maxY: stock.y1 };
    } else if (program && program.n) {
      var b = program.bounds;
      span = { minX: b.minX, maxX: b.maxX, minY: b.minY, maxY: b.maxY };
    } else {
      span = { minX: 0, maxX: 100, minY: 0, maxY: 100 };
    }
    if (span.maxX - span.minX < 1) {
      span.minX -= 10;
      span.maxX += 10;
    }
    if (span.maxY - span.minY < 1) {
      span.minY -= 10;
      span.maxY += 10;
    }
    return span;
  }

  function syncPositionEditors() {
    var panel = $("holeMove");
    var h = holes[selectedHole];
    var threadBtn = $("threadOpen");
    if (!h) {
      panel.hidden = true;
      threadBtn.hidden = true;
      return;
    }
    panel.hidden = false;
    threadBtn.hidden = false;
    threadBtn.textContent = h.thread ? ("Thread · " + (h.thread.name || "custom")) : "Thread this hole";
    $("holeMoveTitle").textContent = "Hole " + (selectedHole + 1);
    var span = workSpan();
    posLock = true;
    $("holeX").min = span.minX;
    $("holeX").max = span.maxX;
    $("holeY").min = span.minY;
    $("holeY").max = span.maxY;
    $("holeX").value = h.x;
    $("holeY").value = h.y;
    if (document.activeElement !== $("holeXNum")) $("holeXNum").value = Number(h.x).toFixed(3);
    if (document.activeElement !== $("holeYNum")) $("holeYNum").value = Number(h.y).toFixed(3);
    posLock = false;
    loadSettings(h);
  }

  function moveSelected(axis, raw) {
    var h = holes[selectedHole];
    if (!h || posLock) return;
    if (raw === "" || raw === "-" || raw === "." || raw === "-.") return;
    var n = Number(raw);
    if (!isFinite(n)) return;
    h[axis] = n;
    var row = $("holeList").querySelectorAll("button")[selectedHole];
    if (row) row.innerHTML = holeRowHtml(h, selectedHole);
    posLock = true;
    var slider = axis === "x" ? $("holeX") : $("holeY");
    var box = axis === "x" ? $("holeXNum") : $("holeYNum");
    if (n < Number(slider.min)) slider.min = String(n);
    if (n > Number(slider.max)) slider.max = String(n);
    slider.value = String(n);
    if (document.activeElement !== box) box.value = n.toFixed(3);
    posLock = false;
    dirty = true;
  }

  function addHole() {
    var span = workSpan();
    var x = (span.minX + span.maxX) / 2;
    var y = (span.minY + span.maxY) / 2;
    var settings = holes[selectedHole] ? readSettings(holes[selectedHole]) : copySettings(nextHole);
    var step = Math.max(settings.diameter || 4, 4);
    var n = holes.length;
    if (n > 0) {
      x += ((n % 5) - 2) * step;
      y += (Math.floor(n / 5)) * step;
      x = Math.min(span.maxX, Math.max(span.minX, x));
      y = Math.min(span.maxY, Math.max(span.minY, y));
    }
    var hole = { x: x, y: y };
    var keys = ["diameter", "depth", "peck", "feed", "spindle", "tool", "through"];
    keys.forEach(function (key) { hole[key] = settings[key]; });
    var previous = holes[selectedHole];
    if (previous && previous.thread) hole.thread = copyThread(previous.thread);
    holes.push(hole);
    selectedHole = holes.length - 1;
    nextHole = copySettings(hole);
    renderHoleList();
    dirty = true;
  }

  function applyThrough() {
    var plate = plateDepth();
    holes.forEach(function (h) {
      if (h.through && plate != null) h.depth = plate;
    });
    if (!settingsLock) {
      var on = $("drillThrough").checked && plate != null;
      $("drillDepth").disabled = on;
      if (on) $("drillDepth").value = Makera.fmt(plate);
      commitSettings();
    }
    dirty = true;
  }

  function removeSelectedHole() {
    if (selectedHole < 0 || selectedHole >= holes.length) return;
    nextHole = copySettings(holes[selectedHole]);
    holes.splice(selectedHole, 1);
    selectedHole = Math.min(selectedHole, holes.length - 1);
    if (!$("threadScrim").hidden) closeThread();
    renderHoleList();
    dirty = true;
  }

  function drawHoles(ctx, m, dpr) {
    if (!holes.length) return;
    var surface = surfaceZ();
    ctx.font = (12 * dpr) + "px Bahnschrift, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (var i = 0; i < holes.length; i++) {
      var h = holes[i];
      var diam = Number(h.diameter);
      if (!(diam > 0)) diam = 1;
      var depth = Number(h.depth);
      var bottom = surface - (depth > 0 ? depth : 0);
      var c = project(h.x, h.y, surface, m);
      var edge = project(h.x + diam / 2, h.y, surface, m);
      if (!c || !edge) continue;
      var radius = Math.max(5 * dpr, Math.hypot(edge[0] - c[0], edge[1] - c[1]));
      var on = i === selectedHole;
      ctx.beginPath();
      ctx.arc(c[0], c[1], radius, 0, Math.PI * 2);
      ctx.lineWidth = (on ? 2.4 : 1.4) * dpr;
      ctx.strokeStyle = on ? "#f0a202" : "#f4efe4";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(c[0], c[1], 2.2 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = "#f0a202";
      ctx.fill();
      var threadRadius = 0;
      if (h.thread && Number(h.thread.major) > 0) {
        var threadEdge = project(h.x + Number(h.thread.major) / 2, h.y, surface, m);
        if (threadEdge) {
          threadRadius = Math.hypot(threadEdge[0] - c[0], threadEdge[1] - c[1]);
          ctx.save();
          ctx.setLineDash([4 * dpr, 3 * dpr]);
          ctx.beginPath();
          ctx.arc(c[0], c[1], threadRadius, 0, Math.PI * 2);
          ctx.lineWidth = 1.4 * dpr;
          ctx.strokeStyle = "#8eb7e8";
          ctx.stroke();
          ctx.restore();
          ctx.fillStyle = "#8eb7e8";
          ctx.fillText(h.thread.name || "thread", c[0], c[1] + Math.max(radius, threadRadius) + 12 * dpr);
        }
      }
      ctx.fillStyle = on ? "#f0a202" : "#f4efe4";
      ctx.fillText(String(i + 1), c[0], c[1] - Math.max(radius, threadRadius) - 8 * dpr);
      if (cam.mode === "iso") {
        var tip = project(h.x, h.y, bottom, m);
        if (tip) {
          ctx.beginPath();
          ctx.moveTo(c[0], c[1]);
          ctx.lineTo(tip[0], tip[1]);
          ctx.lineWidth = 1.4 * dpr;
          ctx.strokeStyle = "rgba(240, 162, 2, 0.85)";
          ctx.stroke();
        }
      }
    }
  }

  function pushLine(buf, n, x0, y0, z0, x1, y1, z1, time, kind) {
    var o = n * 5;
    buf[o] = x0; buf[o + 1] = y0; buf[o + 2] = z0; buf[o + 3] = time; buf[o + 4] = kind;
    buf[o + 5] = x1; buf[o + 6] = y1; buf[o + 7] = z1; buf[o + 8] = time; buf[o + 9] = kind;
    return n + 2;
  }

  function createRenderer() {
    var gl = glCanvas.getContext("webgl", {
      antialias: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false
    });
    if (!gl) return null;
    var vsSource = [
      "attribute vec3 aPos;",
      "attribute float aTime;",
      "attribute float aKind;",
      "uniform mat4 uMVP;",
      "uniform float uSpin;",
      "uniform float uAxisY;",
      "uniform float uAxisZ;",
      "varying float vTime;",
      "varying float vKind;",
      "varying float vZ;",
      "void main(){",
      "  vec3 p=aPos;",
      "  vTime=aTime; vKind=aKind; vZ=aPos.z;",
      "  if(aKind<2.5 || aKind>3.5){",
      "    float y=p.y-uAxisY; float z=p.z-uAxisZ;",
      "    float c=cos(uSpin); float s=sin(uSpin);",
      "    p.y=uAxisY+c*y-s*z;",
      "    p.z=uAxisZ+s*y+c*z;",
      "  }",
      "  gl_Position=uMVP*vec4(p,1.0);",
      "}"
    ].join("\n");
    var fsSource = [
      "precision highp float;",
      "varying float vTime; varying float vKind; varying float vZ;",
      "uniform float uTime; uniform float uZMin; uniform float uZRange; uniform float uShowRapid; uniform float uHideTraveled; uniform float uHideCuts;",
      "void main(){",
      "  if(vKind>3.5){ gl_FragColor=vec4(0.73,0.58,0.34,1.0); return; }",
      "  if(vKind>2.5){ gl_FragColor=vec4(0.34,0.31,0.25,1.0); return; }",
      "  if(vKind>1.5){ gl_FragColor=vec4(0.86,0.62,0.22,1.0); return; }",
      "  if(uHideCuts>0.5 && vKind<0.5) discard;",
      "  if(vKind>0.5 && uShowRapid<0.5) discard;",
      "  if(uHideTraveled>0.5 && vKind>=0.0 && vTime<=uTime) discard;",
      "  float depth=clamp((vZ-uZMin)/uZRange,0.0,1.0);",
      "  vec3 col=mix(vec3(0.86,0.38,0.16), vec3(0.66,0.78,0.48), depth);",
      "  if(vKind>0.5) col=vec3(0.62,0.54,0.40);",
      "  if(vTime>uTime) col=mix(vec3(0.73,0.62,0.42), col, 0.35);",
      "  gl_FragColor=vec4(col,1.0);",
      "}"
    ].join("\n");
    function compile(type, src) {
      var sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(sh));
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    }
    var vs = compile(gl.VERTEX_SHADER, vsSource);
    var fs = compile(gl.FRAGMENT_SHADER, fsSource);
    if (!fs) fs = compile(gl.FRAGMENT_SHADER, fsSource.replace("highp", "mediump"));
    if (!vs || !fs) return null;
    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    gl.enable(gl.DEPTH_TEST);
    gl.lineWidth(1);
    var buffer = gl.createBuffer();
    var shape = compileShapeProgram(gl);
    return {
      gl: gl,
      prog: prog,
      buffer: buffer,
      shapeProg: shape && shape.prog,
      shapeBuffer: shape && shape.buffer,
      sMVP: shape && shape.uMVP,
      sSpin: shape && shape.uSpin,
      sAxisY: shape && shape.uAxisY,
      sAxisZ: shape && shape.uAxisZ,
      sColor: shape && shape.sColor,
      sPos: shape ? shape.aPos : -1,
      sNrm: shape ? shape.aNrm : -1,
      shapeVerts: 0,
      pathVerts: 0,
      gridStart: 0,
      gridVerts: 0,
      stockStart: 0,
      stockVerts: 0,
      uMVP: gl.getUniformLocation(prog, "uMVP"),
      uSpin: gl.getUniformLocation(prog, "uSpin"),
      uAxisY: gl.getUniformLocation(prog, "uAxisY"),
      uAxisZ: gl.getUniformLocation(prog, "uAxisZ"),
      uTime: gl.getUniformLocation(prog, "uTime"),
      uZMin: gl.getUniformLocation(prog, "uZMin"),
      uZRange: gl.getUniformLocation(prog, "uZRange"),
      uShowRapid: gl.getUniformLocation(prog, "uShowRapid"),
      uHideTraveled: gl.getUniformLocation(prog, "uHideTraveled"),
      uHideCuts: gl.getUniformLocation(prog, "uHideCuts"),
      aPos: gl.getAttribLocation(prog, "aPos"),
      aTime: gl.getAttribLocation(prog, "aTime"),
      aKind: gl.getAttribLocation(prog, "aKind")
    };
  }

  function compileShapeProgram(gl) {
    var vs = [
      "attribute vec3 aPos;",
      "attribute vec3 aNrm;",
      "uniform mat4 uMVP;",
      "uniform float uSpin;",
      "uniform float uAxisY;",
      "uniform float uAxisZ;",
      "varying vec3 vNrm;",
      "void main(){",
      "  vec3 p=aPos; vec3 n=aNrm;",
      "  float y=p.y-uAxisY; float z=p.z-uAxisZ;",
      "  float c=cos(uSpin); float s=sin(uSpin);",
      "  p.y=uAxisY+c*y-s*z; p.z=uAxisZ+s*y+c*z;",
      "  n.y=c*aNrm.y-s*aNrm.z; n.z=s*aNrm.y+c*aNrm.z;",
      "  vNrm=n;",
      "  gl_Position=uMVP*vec4(p,1.0);",
      "}"
    ].join("\n");
    var fs = [
      "precision mediump float;",
      "varying vec3 vNrm;",
      "uniform vec3 uColor;",
      "void main(){",
      "  vec3 n=normalize(vNrm);",
      "  vec3 L=normalize(vec3(0.25,0.62,0.74));",
      "  vec3 F=normalize(vec3(-0.55,-0.12,0.38));",
      "  float key=clamp(dot(n,L),0.0,1.0);",
      "  float fill=clamp(dot(n,F),0.0,1.0);",
      "  float shade=0.14+0.72*key+0.24*fill;",
      "  vec3 col=uColor*shade;",
      "  gl_FragColor=vec4(col,1.0);",
      "}"
    ].join("\n");
    function compile(type, src) {
      var sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    }
    var vsh = compile(gl.VERTEX_SHADER, vs);
    var fsh = compile(gl.FRAGMENT_SHADER, fs);
    if (!vsh || !fsh) return null;
    var prog = gl.createProgram();
    gl.attachShader(prog, vsh);
    gl.attachShader(prog, fsh);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    return {
      prog: prog,
      buffer: gl.createBuffer(),
      uMVP: gl.getUniformLocation(prog, "uMVP"),
      uSpin: gl.getUniformLocation(prog, "uSpin"),
      uAxisY: gl.getUniformLocation(prog, "uAxisY"),
      uAxisZ: gl.getUniformLocation(prog, "uAxisZ"),
      sColor: gl.getUniformLocation(prog, "uColor"),
      aPos: gl.getAttribLocation(prog, "aPos"),
      aNrm: gl.getAttribLocation(prog, "aNrm")
    };
  }

  function prepareRenderer() {
    if (!renderer) return;
    var gl = renderer.gl;
    var stride = 20;
    gl.useProgram(renderer.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, renderer.buffer);
    gl.enableVertexAttribArray(renderer.aPos);
    gl.vertexAttribPointer(renderer.aPos, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(renderer.aTime);
    gl.vertexAttribPointer(renderer.aTime, 1, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(renderer.aKind);
    gl.vertexAttribPointer(renderer.aKind, 1, gl.FLOAT, false, stride, 16);
    gl.enable(gl.DEPTH_TEST);
    gl.lineWidth(1);
  }

  function finalPassStart(prog) {
    if (prog._finalPass != null) return prog._finalPass;
    var list = prog.meta && prog.meta.toolpaths ? prog.meta.toolpaths : [];
    var start = 0;
    var found = false;
    for (var t = 0; t < list.length; t++) {
      if (list[t].startSeg == null) continue;
      if (!found || list[t].startSeg >= start) {
        start = list[t].startSeg;
        found = true;
      }
    }
    var begin = prog.n;
    if (found) {
      var i = prog.n - 1;
      while (i >= start && prog.rapid[i]) i--;
      while (i >= start && !prog.rapid[i]) i--;
      begin = i + 1;
    }
    prog._finalPass = begin;
    return begin;
  }

  function uploadPath() {
    if (!renderer || !program) return;
    var gl = renderer.gl;
    var n = program.n;
    var stock = stockBox();
    var bnds = program.bounds;
    var x0 = stock ? stock.x0 : bnds.minX;
    var x1 = stock ? stock.x1 : bnds.maxX;
    var y0 = stock ? stock.y0 : bnds.minY;
    var y1 = stock ? stock.y1 : bnds.maxY;
    var wrap = rotaryOn();
    var axis = wrap ? rotaryAxis() : null;
    var shape = null;
    if (renderer.shapeProg) {
      if (wrap) {
        if (program._finishShape === undefined) program._finishShape = Makera.buildFinishShape(program, axis);
        shape = program._finishShape;
      } else if (!program.rotary) {
        if (program._flatShape === undefined) program._flatShape = Makera.buildFinishShape(program, null);
        shape = program._flatShape;
      }
    }
    renderer.shapeVerts = shape && shape.count ? shape.count : 0;
    renderer.shapeFlat = !!(shape && shape.flat);
    renderer.shapeColor = shape && shape.color ? shape.color : [0.64, 0.41, 0.22];
    var skipFrom = renderer.shapeVerts && !shape.flat ? shape.from : n;
    var angles = program.a;
    var pathVerts = 0;
    for (var c = 0; c < n && c < skipFrom; c++) {
      pathVerts += segmentSteps(angles ? angles[c] : 0, angles ? angles[c + 1] : 0, wrap) * 2;
    }
    var gridLines = 22;
    var cylVerts = wrap && stock ? (7 * 24 + 8) * 2 : 0;
    var decorVerts = gridLines * 2 + (stock ? 24 : 0) + cylVerts;
    var buf = new Float32Array((pathVerts + decorVerts) * 5);
    var total = program.totalTime || 1;
    var cursor = 0;
    var keepFrom = wrap && !renderer.shapeVerts ? finalPassStart(program) : n;
    for (var i = 0; i < n && i < skipFrom; i++) {
      var a0 = angles ? angles[i] : 0;
      var a1 = angles ? angles[i + 1] : 0;
      var steps = segmentSteps(a0, a1, wrap);
      var t0 = i === 0 ? 0 : program.tEnd[i - 1];
      var t1 = program.tEnd[i];
      for (var s = 1; s <= steps; s++) {
        var u0 = (s - 1) / steps;
        var u1 = s / steps;
        var o = cursor * 5;
        wrapInto(buf, o,
          program.x[i] + (program.x[i + 1] - program.x[i]) * u0,
          program.y[i] + (program.y[i + 1] - program.y[i]) * u0,
          program.z[i] + (program.z[i + 1] - program.z[i]) * u0,
          a0 + (a1 - a0) * u0, axis);
        var kind = program.rapid[i] ? 1 : (i >= keepFrom ? -1 : 0);
        buf[o + 3] = (t0 + (t1 - t0) * u0) / total;
        buf[o + 4] = kind;
        wrapInto(buf, o + 5,
          program.x[i] + (program.x[i + 1] - program.x[i]) * u1,
          program.y[i] + (program.y[i + 1] - program.y[i]) * u1,
          program.z[i] + (program.z[i + 1] - program.z[i]) * u1,
          a0 + (a1 - a0) * u1, axis);
        buf[o + 8] = (t0 + (t1 - t0) * u1) / total;
        buf[o + 9] = kind;
        cursor += 2;
      }
    }
    renderer.pathVerts = cursor;
    var z0 = stock ? stock.z0 : Math.min(bnds.minZ, 0);
    var spanX = Math.max(1, x1 - x0);
    var spanY = Math.max(1, y1 - y0);
    var stepX = spanX / 10;
    var stepY = spanY / 10;
    renderer.gridStart = cursor;
    for (var g = 0; g <= 10; g++) {
      var gx = x0 + stepX * g;
      var gy = y0 + stepY * g;
      cursor = pushLine(buf, cursor, gx, y0, z0, gx, y1, z0, 0, 3);
      cursor = pushLine(buf, cursor, x0, gy, z0, x1, gy, z0, 0, 3);
    }
    renderer.gridVerts = cursor - renderer.gridStart;
    renderer.stockStart = cursor;
    if (stock) {
      var s = stock;
      var edges = [
        [s.x0, s.y0, s.z0, s.x1, s.y0, s.z0],
        [s.x1, s.y0, s.z0, s.x1, s.y1, s.z0],
        [s.x1, s.y1, s.z0, s.x0, s.y1, s.z0],
        [s.x0, s.y1, s.z0, s.x0, s.y0, s.z0],
        [s.x0, s.y0, s.z1, s.x1, s.y0, s.z1],
        [s.x1, s.y0, s.z1, s.x1, s.y1, s.z1],
        [s.x1, s.y1, s.z1, s.x0, s.y1, s.z1],
        [s.x0, s.y1, s.z1, s.x0, s.y0, s.z1],
        [s.x0, s.y0, s.z0, s.x0, s.y0, s.z1],
        [s.x1, s.y0, s.z0, s.x1, s.y0, s.z1],
        [s.x1, s.y1, s.z0, s.x1, s.y1, s.z1],
        [s.x0, s.y1, s.z0, s.x0, s.y1, s.z1]
      ];
      for (var e = 0; e < edges.length; e++) {
        var ed = edges[e];
        cursor = pushLine(buf, cursor, ed[0], ed[1], ed[2], ed[3], ed[4], ed[5], 0, 2);
      }
      if (wrap && axis && axis.radius > 0) {
        var slices = 24;
        var rings = 7;
        for (var ring = 0; ring < rings; ring++) {
          var cx = axis.x0 + (axis.x1 - axis.x0) * ring / (rings - 1);
          for (var sl = 0; sl < slices; sl++) {
            var ang0 = (sl / slices) * Math.PI * 2;
            var ang1 = ((sl + 1) / slices) * Math.PI * 2;
            cursor = pushLine(buf, cursor,
              cx, axis.y + axis.radius * Math.sin(ang0), axis.z + axis.radius * Math.cos(ang0),
              cx, axis.y + axis.radius * Math.sin(ang1), axis.z + axis.radius * Math.cos(ang1),
              0, 4);
          }
        }
        for (var lon = 0; lon < slices; lon += 3) {
          var ang = (lon / slices) * Math.PI * 2;
          var ly = axis.y + axis.radius * Math.sin(ang);
          var lz = axis.z + axis.radius * Math.cos(ang);
          cursor = pushLine(buf, cursor, axis.x0, ly, lz, axis.x1, ly, lz, 0, 4);
        }
      }
    }
    renderer.stockVerts = cursor - renderer.stockStart;
    if (renderer.shapeVerts && renderer.shapeBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, renderer.shapeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, shape.data, gl.STATIC_DRAW);
    }
    prepareRenderer();
    gl.bufferData(gl.ARRAY_BUFFER, buf.subarray(0, cursor * 5), gl.STATIC_DRAW);
    updateShapeNote();
  }

  function drawScene() {
    var m = mvpMatrix();
    var sample = program && program.n ? Makera.sampleAt(program, simTime) : null;
    var spinOn = !!(sample && rotaryOn());
    var spin = spinOn ? (sample.a || 0) * Math.PI / 180 : 0;
    var axis = spinOn ? rotaryAxis() : null;
    if (renderer && program) {
      prepareRenderer();
      var gl = renderer.gl;
      gl.viewport(0, 0, glCanvas.width, glCanvas.height);
      gl.clearColor(0.063, 0.055, 0.043, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(renderer.uMVP, false, m);
      gl.uniform1f(renderer.uSpin, spin);
      gl.uniform1f(renderer.uAxisY, axis ? axis.y : 0);
      gl.uniform1f(renderer.uAxisZ, axis ? axis.z : 0);
      var norm = program.totalTime > 0 ? simTime / program.totalTime : 0;
      gl.uniform1f(renderer.uTime, norm);
      var range = Math.max(0.001, colorZ.max - colorZ.min);
      gl.uniform1f(renderer.uZMin, colorZ.min);
      gl.uniform1f(renderer.uZRange, range);
      gl.uniform1f(renderer.uShowRapid, showRapids ? 1 : 0);
      var hideTraveled = spinOn || !program.rotary;
      gl.uniform1f(renderer.uHideTraveled, hideTraveled ? 1 : 0);
      var showSolid = !!(renderer.shapeVerts && (spinOn || (renderer.shapeFlat && cam.mode !== "top")));
      gl.uniform1f(renderer.uHideCuts, showPaths ? 0 : 1);
      if (renderer.gridVerts) gl.drawArrays(gl.LINES, renderer.gridStart, renderer.gridVerts);
      if (showSolid && renderer.shapeProg) {
        gl.useProgram(renderer.shapeProg);
        gl.bindBuffer(gl.ARRAY_BUFFER, renderer.shapeBuffer);
        if (renderer.aTime >= 0) gl.disableVertexAttribArray(renderer.aTime);
        if (renderer.aKind >= 0) gl.disableVertexAttribArray(renderer.aKind);
        gl.enableVertexAttribArray(renderer.sPos);
        gl.vertexAttribPointer(renderer.sPos, 3, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(renderer.sNrm);
        gl.vertexAttribPointer(renderer.sNrm, 3, gl.FLOAT, false, 24, 12);
        gl.uniformMatrix4fv(renderer.sMVP, false, m);
        gl.uniform1f(renderer.sSpin, spin);
        gl.uniform1f(renderer.sAxisY, axis ? axis.y : 0);
        gl.uniform1f(renderer.sAxisZ, axis ? axis.z : 0);
        if (renderer.sColor) gl.uniform3fv(renderer.sColor, renderer.shapeColor || [0.64, 0.41, 0.22]);
        gl.drawArrays(gl.TRIANGLES, 0, renderer.shapeVerts);
        if (renderer.sPos >= 0) gl.disableVertexAttribArray(renderer.sPos);
        if (renderer.sNrm >= 0) gl.disableVertexAttribArray(renderer.sNrm);
        gl.useProgram(renderer.prog);
        prepareRenderer();
        gl.uniformMatrix4fv(renderer.uMVP, false, m);
        gl.uniform1f(renderer.uSpin, spin);
        gl.uniform1f(renderer.uAxisY, axis ? axis.y : 0);
        gl.uniform1f(renderer.uAxisZ, axis ? axis.z : 0);
        gl.uniform1f(renderer.uTime, norm);
        gl.uniform1f(renderer.uZMin, colorZ.min);
        gl.uniform1f(renderer.uZRange, range);
        gl.uniform1f(renderer.uShowRapid, showRapids ? 1 : 0);
        gl.uniform1f(renderer.uHideTraveled, hideTraveled ? 1 : 0);
        gl.uniform1f(renderer.uHideCuts, showPaths ? 0 : 1);
      }
      if (showStock && renderer.stockVerts) gl.drawArrays(gl.LINES, renderer.stockStart, renderer.stockVerts);
      if (renderer.pathVerts) gl.drawArrays(gl.LINES, 0, renderer.pathVerts);
    }
    var ctx = ovCanvas.getContext("2d");
    ctx.clearRect(0, 0, ovCanvas.width, ovCanvas.height);
    var dpr = ovCanvas.width / Math.max(1, stage.clientWidth);
    if (!program || !program.n) {
      drawHoles(ctx, m, dpr);
      drawShapes(ctx, m, dpr);
      drawGizmo(ctx, m, dpr);
      return;
    }
    if (!renderer) {
      ctx.fillStyle = "#100e0b";
      ctx.fillRect(0, 0, ovCanvas.width, ovCanvas.height);
      var stride = Math.max(1, Math.ceil(program.n / 40000));
      ctx.beginPath();
      ctx.lineWidth = Math.max(1, ovCanvas.width / Math.max(1, stage.clientWidth));
      ctx.strokeStyle = "rgba(214, 168, 92, 0.9)";
      var wrapDraw = rotaryOn();
      for (var seg = 0; seg < program.n; seg += stride) {
        if (!showPaths && !program.rapid[seg]) continue;
        if (!showRapids && program.rapid[seg]) continue;
        var sa0 = program.a ? program.a[seg] : 0;
        var sa1 = program.a ? program.a[seg + 1] : 0;
        var segs = segmentSteps(sa0, sa1, wrapDraw);
        for (var st = 1; st <= segs; st++) {
          var su0 = (st - 1) / segs;
          var su1 = st / segs;
          var segT0 = seg === 0 ? 0 : program.tEnd[seg - 1];
          var segT1 = program.tEnd[seg];
          var keepLast = wrapDraw && !program.rapid[seg] && seg >= finalPassStart(program);
          if (!keepLast && (wrapDraw || !program.rotary) && segT0 + (segT1 - segT0) * su1 <= simTime) continue;
          var wa0 = displayPoint(
            program.x[seg] + (program.x[seg + 1] - program.x[seg]) * su0,
            program.y[seg] + (program.y[seg + 1] - program.y[seg]) * su0,
            program.z[seg] + (program.z[seg + 1] - program.z[seg]) * su0,
            sa0 + (sa1 - sa0) * su0);
          var wa1 = displayPoint(
            program.x[seg] + (program.x[seg + 1] - program.x[seg]) * su1,
            program.y[seg] + (program.y[seg + 1] - program.y[seg]) * su1,
            program.z[seg] + (program.z[seg + 1] - program.z[seg]) * su1,
            sa0 + (sa1 - sa0) * su1);
          wa0 = spinWorld(wa0, spin, axis);
          wa1 = spinWorld(wa1, spin, axis);
          var pa = project(wa0[0], wa0[1], wa0[2], m);
          var pb = project(wa1[0], wa1[1], wa1[2], m);
          if (!pa || !pb) continue;
          ctx.moveTo(pa[0], pa[1]);
          ctx.lineTo(pb[0], pb[1]);
        }
      }
      ctx.stroke();
    }
    drawHoles(ctx, m, dpr);
    drawShapes(ctx, m, dpr);
    var marker = spinOn ? [sample.x, sample.y, sample.z] : displayPoint(sample.x, sample.y, sample.z, sample.a);
    var p = project(marker[0], marker[1], marker[2], m);
    if (!p) {
      drawGizmo(ctx, m, dpr);
      return;
    }
    ctx.beginPath();
    ctx.arc(p[0], p[1], 6.5 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = "#f6f1e6";
    ctx.fill();
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = "#f0a202";
    ctx.stroke();
    drawGizmo(ctx, m, dpr);
  }

  function drawGizmo(ctx, m, dpr) {
    var origin = project(cam.targetX, cam.targetY, cam.targetZ, m);
    var axisX = project(cam.targetX + 1, cam.targetY, cam.targetZ, m);
    var axisY = project(cam.targetX, cam.targetY + 1, cam.targetZ, m);
    var axisZ = project(cam.targetX, cam.targetY, cam.targetZ + 1, m);
    if (origin && axisX && axisY && axisZ) {
      drawAxis(ctx, dpr, origin, axisX, "#e07a4a", "X");
      drawAxis(ctx, dpr, origin, axisY, "#b7c77a", "Y");
      drawAxis(ctx, dpr, origin, axisZ, "#8fb7d6", "Z");
    }
  }

  function drawAxis(ctx, dpr, origin, tip, color, label) {
    var dx = tip[0] - origin[0];
    var dy = tip[1] - origin[1];
    var len = Math.hypot(dx, dy) || 1;
    var ox = 28 * dpr;
    var oy = ovCanvas.height - 28 * dpr;
    var scale = (22 * dpr) / len;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + dx * scale, oy + dy * scale);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * dpr;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = (11 * dpr) + "px Bahnschrift, Segoe UI, sans-serif";
    ctx.fillText(label, ox + dx * scale + 3 * dpr, oy + dy * scale);
  }

  function resize() {
    var rect = stage.getBoundingClientRect();
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = Math.max(1, Math.floor(rect.width * dpr));
    var h = Math.max(1, Math.floor(rect.height * dpr));
    if (glCanvas.width !== w || glCanvas.height !== h) {
      glCanvas.width = w;
      glCanvas.height = h;
      ovCanvas.width = w;
      ovCanvas.height = h;
      dirty = true;
    }
  }

  function paintPlay() {
    $("play").dataset.state = playing ? "pause" : "play";
    $("play").setAttribute("aria-label", playing ? "Pause" : "Play");
  }

  function togglePlay() {
    if (!program) return;
    if (!playing && program.totalTime > 0 && simTime >= program.totalTime - 0.001) simTime = 0;
    playing = !playing;
    paintPlay();
    dirty = true;
  }

  function seekPercent(pct) {
    if (!program) return;
    if (pct < 0) pct = 0;
    if (pct > 100) pct = 100;
    simTime = (pct / 100) * program.totalTime;
    dirty = true;
    updateReadout();
  }

  async function loadText(text, name) {
    var token = ++loadToken;
    playing = false;
    paintPlay();
    setBusy(true, "Plotting the toolpath", 0, name);
    var parsed;
    try {
      parsed = await Makera.parseProgram(text, function (ratio, moves) {
        if (token !== loadToken) return;
        setBusy(true, "Plotting the toolpath", ratio, moves.toLocaleString("en-US") + " moves");
      });
    } catch (err) {
      setBusy(false);
      setStatus(err && err.message ? err.message : "Could not read that file.");
      return;
    }
    if (token !== loadToken) return;
    if (!parsed.n) {
      setBusy(false);
      setStatus("No cutter motion was found in that file.");
      return;
    }
    sourceText = text;
    sourceName = name;
    baseText = text;
    baseName = name;
    baseProgram = parsed;
    program = parsed;
    sourceIsPatch = false;
    showRotary = !!parsed.rotary;
    if (parsed.rotary) {
      cam.mode = "iso";
      setPressed("viewTop", false);
      setPressed("viewIso", true);
    }
    shapes = [];
    selectedShape = -1;
    drawTool = null;
    polyPoints = null;
    polyCursor = null;
    rubber = null;
    stage.classList.remove("placing");
    ["patchRect", "patchCircle", "patchPoly"].forEach(function (id) { setPressed(id, false); });
    renderPatchList();
    setBusy(true, "Preparing the view", 1, "");
    await new Promise(function (resolve) { setTimeout(resolve, 30); });
    if (!renderer) renderer = createRenderer();
    resize();
    if (renderer) uploadPath();
    showRapids = true;
    setPressed("rapidsBtn", true);
    showPaths = true;
    setPressed("pathsBtn", true);
    if (!parsed.rotary && program._flatShape && program._flatShape.count) {
      cam.mode = "iso";
      setPressed("viewTop", false);
      setPressed("viewIso", true);
      showRapids = false;
      setPressed("rapidsBtn", false);
      showPaths = false;
      setPressed("pathsBtn", false);
    }
    syncFacebar();
    fillJob(parsed.rotary
      ? "4th axis. The stock spins under the bit, and the bit stays on X, Y, and Z. The solid form is the finished shape of the last pass. Turn Rotary off to see the flat cross section."
      : (program._flatShape && program._flatShape.count
        ? "The solid is the finishing passes. Paths turns the cut lines on. It is a preview, not a measurement."
        : ""));
    setBusy(false);
    dirty = true;
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onprogress = function (e) {
        if (e.lengthComputable) {
          setBusy(true, "Reading " + file.name, e.loaded / e.total, Math.round(e.loaded / 1048576) + " MB");
        }
      };
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error || new Error("Read failed")); };
      reader.readAsText(file);
    });
  }

  async function loadFile(file) {
    if (!file) return;
    setBusy(true, "Reading " + file.name, 0, "");
    try {
      var text = await readFile(file);
      await loadText(text, file.name);
    } catch (err) {
      setBusy(false);
      setStatus("Could not read that file.");
    }
  }

  function redoNote(name, redo) {
    if (redo.rotaryKind === "full") {
      return "Saved the full program as " + name + ". The playhead was at " + redo.parkedPercent.toFixed(1) + "%, before the first end of X.";
    }
    var line = "line " + redo.lineNo.toLocaleString("en-US");
    if (redo.rotaryKind === "toolpath") {
      return "Saved " + name + " from " + redo.percent.toFixed(1) + "% (" + line + "). The playhead was at " + redo.parkedPercent.toFixed(1) + "%. This finish does not return to an end of X, so the file starts at the beginning of that finish.";
    }
    if (redo.rotaryKind === "pass") {
      var base = "Saved " + name + " from " + redo.percent.toFixed(1) + "% (" + line + ").";
      if (Math.abs(redo.parkedPercent - redo.percent) >= 0.15) {
        return base + " The playhead was at " + redo.parkedPercent.toFixed(1) + "%. The restart is the lifted end of that pass, before the wood turns through the cut.";
      }
      return base + " The angle is set at clearance before the bit feeds down.";
    }
    if (redo.passthrough) {
      return "Saved the " + (sourceIsPatch ? "patched program" : "full original program") + " as " + name + ".";
    }
    return "Saved " + name + " from " + redo.percent.toFixed(1) + "% (" + line + ").";
  }

  async function saveRedo() {
    if (!program) return;
    setStatus("Building the redo file…");
    await new Promise(function (resolve) { setTimeout(resolve, 20); });
    var redo = Makera.buildRedo(sourceText, program, simTime, sourceName);
    if (redo.refused) {
      setStatus(redo.message);
      return;
    }
    var name = ($("filename").value || "").trim() || redo.name;
    if (redo.rotaryRewind && !nameEdited) name = redo.name;
    if (!/\.nc$/i.test(name)) name += ".NC";
    if (redo.rotaryRewind && !nameEdited) $("filename").value = name;
    try {
      var how = await saveText(name, redo.content);
      if (how === "cancel") {
        setStatus("");
        return;
      }
      setStatus(redoNote(name, redo));
    } catch (err) {
      setStatus("The browser did not save the file.");
    }
  }

  function saveText(filename, content) {
    if (window.showSaveFilePicker && window.isSecureContext) {
      return window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "NC program", accept: { "application/octet-stream": [".NC", ".nc"] } }]
      }).then(function (handle) {
        return handle.createWritable().then(function (writable) {
          return writable.write(content).then(function () { return writable.close(); }).then(function () { return "picker"; });
        });
      }).catch(function (err) {
        if (err && err.name === "AbortError") return "cancel";
        downloadBlob(filename, content);
        return "download";
      });
    }
    downloadBlob(filename, content);
    return Promise.resolve("download");
  }

  function downloadBlob(filename, content) {
    var blob = new Blob([content], { type: "text/plain" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  $("openBtn").addEventListener("click", function () { fileInput.click(); });
  fileInput.addEventListener("change", function () {
    var file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    loadFile(file);
  });

  window.addEventListener("dragover", function (e) {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf("Files") >= 0) e.preventDefault();
  });
  window.addEventListener("drop", function (e) {
    if (!(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0])) return;
    e.preventDefault();
    loadFile(e.dataTransfer.files[0]);
  });

  $("play").addEventListener("click", togglePlay);
  $("speed").addEventListener("change", function () { speed = Number($("speed").value) || 1; });
  $("scrub").addEventListener("pointerdown", function () { playing = false; paintPlay(); });
  $("scrub").addEventListener("input", function () {
    seekPercent(Number($("scrub").value) / 100);
  });
  $("percent").addEventListener("change", function () { seekPercent(Number($("percent").value)); });
  $("prevLift").addEventListener("click", function () {
    if (!program) return;
    var t = Makera.adjacentLift(program, simTime, -1);
    if (t == null) return;
    playing = false;
    paintPlay();
    simTime = t;
    dirty = true;
    updateReadout();
  });
  $("nextLift").addEventListener("click", function () {
    if (!program) return;
    var t = Makera.adjacentLift(program, simTime, 1);
    if (t == null) return;
    playing = false;
    paintPlay();
    simTime = t;
    dirty = true;
    updateReadout();
  });
  $("saveBtn").addEventListener("click", saveRedo);
  $("filename").addEventListener("input", function () { nameEdited = true; });
  $("nameReset").addEventListener("click", function () {
    nameEdited = false;
    syncNameFromTime();
  });

  $("viewTop").addEventListener("click", function () {
    cam.mode = "top";
    setPressed("viewTop", true);
    setPressed("viewIso", false);
    syncFacebar();
    updateShapeNote();
    dirty = true;
  });
  $("facebar").addEventListener("click", function (e) {
    var btn = e.target.closest("button");
    if (!btn || !FACES[btn.dataset.face]) return;
    var face = FACES[btn.dataset.face];
    cam.mode = "iso";
    cam.yaw = face.yaw;
    cam.pitch = face.pitch;
    setPressed("viewTop", false);
    setPressed("viewIso", true);
    if (program) fitView();
    syncFacebar();
    updateShapeNote();
    dirty = true;
  });
  $("viewIso").addEventListener("click", function () {
    cam.mode = "iso";
    setPressed("viewTop", false);
    setPressed("viewIso", true);
    syncFacebar();
    if (program && program._flatShape && program._flatShape.count) fitView();
    updateShapeNote();
    dirty = true;
  });
  $("rotaryBtn").addEventListener("click", function () {
    if (!program || !program.rotary) return;
    showRotary = !showRotary;
    setPressed("rotaryBtn", showRotary);
    if (renderer) uploadPath();
    colorZ = cutColorRange(program);
    $("zTop").textContent = Makera.fmt(colorZ.max);
    $("zBot").textContent = Makera.fmt(colorZ.min);
    fitView();
    updateShapeNote();
    dirty = true;
  });
  $("pathsBtn").addEventListener("click", function () {
    showPaths = !showPaths;
    setPressed("pathsBtn", showPaths);
    dirty = true;
  });
  $("rapidsBtn").addEventListener("click", function () {
    showRapids = !showRapids;
    setPressed("rapidsBtn", showRapids);
    dirty = true;
  });
  $("stockBtn").addEventListener("click", function () {
    showStock = !showStock;
    setPressed("stockBtn", showStock);
    dirty = true;
  });
  $("fitBtn").addEventListener("click", fitView);
  stage.addEventListener("dblclick", function (e) {
    if (drawTool) {
      e.preventDefault();
      return;
    }
    fitView();
  });

  var dragging = false;
  var dragMode = "pan";
  var downMoved = false;
  stage.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  stage.addEventListener("pointerdown", function (e) {
    if (e.target.closest("button")) return;
    downMoved = false;
    if (drawTool && e.button === 0 && !e.shiftKey && cam.mode === "top") {
      var pt = workFromEvent(e);
      if (drawTool === "poly") {
        addPolyPoint(pt);
        return;
      }
      rubber = { type: drawTool, x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y };
      dragging = true;
      dragMode = "draw";
      stage.classList.add("placing");
      stage.setPointerCapture(e.pointerId);
      dirty = true;
      return;
    }
    dragging = true;
    dragMode = (cam.mode === "iso" && e.button === 0 && !e.shiftKey) ? "orbit" : "pan";
    stage.classList.add("dragging");
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener("pointerup", function (e) {
    if (dragMode === "draw" && rubber) finishRubber();
    else if (!downMoved && !drawTool && e.button === 0 && cam.mode === "top") {
      var hit = workFromEvent(e);
      var at = shapeAt(hit.x, hit.y);
      if (at >= 0) {
        selectedShape = at;
        renderPatchList();
        dirty = true;
      }
    }
    dragging = false;
    dragMode = "pan";
    stage.classList.remove("dragging");
  });
  stage.addEventListener("pointermove", function (e) {
    if (drawTool === "poly" && polyPoints) {
      polyCursor = workFromEvent(e);
      dirty = true;
    }
    if (!dragging) return;
    if (Math.hypot(e.movementX, e.movementY) > 3) downMoved = true;
    if (dragMode === "draw" && rubber) {
      var pt = workFromEvent(e);
      rubber.x1 = pt.x;
      rubber.y1 = pt.y;
      dirty = true;
      return;
    }
    if (dragMode === "orbit") {
      cam.yaw -= e.movementX * 0.008;
      cam.pitch += e.movementY * 0.008;
      if (cam.pitch < -1.55) cam.pitch = -1.55;
      if (cam.pitch > 1.55) cam.pitch = 1.55;
      syncFacebar();
    } else if (cam.mode === "top") {
      var scale = cam.viewH / Math.max(1, stage.clientHeight);
      cam.targetX -= e.movementX * scale;
      cam.targetY += e.movementY * scale;
    } else {
      var size = viewSize();
      var scaleX = (size.halfW * 2) / Math.max(1, stage.clientWidth);
      var scaleY = cam.viewH / Math.max(1, stage.clientHeight);
      var cp = Math.cos(cam.pitch);
      var sp = Math.sin(cam.pitch);
      var cy = Math.cos(cam.yaw);
      var sy = Math.sin(cam.yaw);
      var rx = -sy;
      var ry = cy;
      var ux = -cy * sp;
      var uy = -sy * sp;
      var uz = cp;
      var dx = -e.movementX * scaleX;
      var dy = e.movementY * scaleY;
      cam.targetX += rx * dx + ux * dy;
      cam.targetY += ry * dx + uy * dy;
      cam.targetZ += uz * dy;
    }
    dirty = true;
  });

  stage.addEventListener("wheel", function (e) {
    e.preventDefault();
    var rect = stage.getBoundingClientRect();
    var px = (e.clientX - rect.left) / rect.width;
    var py = (e.clientY - rect.top) / rect.height;
    var factor = Math.exp(e.deltaY * 0.0011);
    if (cam.mode === "top") {
      var aspect = rect.width / Math.max(1, rect.height);
      var worldX = cam.targetX + (px - 0.5) * cam.viewH * aspect;
      var worldY = cam.targetY + (0.5 - py) * cam.viewH;
      cam.viewH = Math.min(5000, Math.max(1, cam.viewH * factor));
      cam.targetX = worldX - (px - 0.5) * cam.viewH * aspect;
      cam.targetY = worldY - (0.5 - py) * cam.viewH;
    } else {
      cam.viewH = Math.min(5000, Math.max(1, cam.viewH * factor));
    }
    dirty = true;
  }, { passive: false });

  window.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !$("threadScrim").hidden) {
      e.preventDefault();
      closeThread();
      return;
    }
    if (e.key === "Escape" && (drawTool || polyPoints)) {
      e.preventDefault();
      armDraw(null);
      return;
    }
    if (e.target && e.target.matches && e.target.matches("input, textarea, select")) return;
    if (e.code === "Space") {
      e.preventDefault();
      togglePlay();
    } else if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
      e.preventDefault();
      if (!program || !program.totalTime) return;
      playing = false;
      paintPlay();
      var step = e.shiftKey ? 1 : 0.1;
      var pct = (simTime / program.totalTime) * 100;
      seekPercent(pct + (e.code === "ArrowRight" ? step : -step));
    } else if (e.code === "Home") {
      seekPercent(0);
    } else if (e.code === "End") {
      seekPercent(100);
    } else if (e.key === "f" || e.key === "F") {
      fitView();
    } else if (e.code === "Delete") {
      if (!$("threadScrim").hidden) return;
      removeSelectedHole();
    }
  });

  function workFromEvent(e) {
    var rect = stage.getBoundingClientRect();
    var px = (e.clientX - rect.left) / Math.max(1, rect.width);
    var py = (e.clientY - rect.top) / Math.max(1, rect.height);
    var aspect = rect.width / Math.max(1, rect.height);
    return {
      x: cam.targetX + (px - 0.5) * cam.viewH * aspect,
      y: cam.targetY + (0.5 - py) * cam.viewH
    };
  }

  function worldGeometry(shape) {
    var mode = shape.mode === "outside" ? "outside" : "inside";
    if (shape.type === "circle") {
      var diameter = Number(shape.diameter);
      if (!(diameter > 0)) return null;
      return { type: "circle", mode: mode, cx: shape.cx, cy: shape.cy, r: diameter / 2 };
    }
    if (shape.type === "rect") {
      var hx = shape.hw * shape.scale;
      var hy = shape.hh * shape.scale;
      if (!(hx > 0) || !(hy > 0)) return null;
      return { type: "rect", mode: mode, minX: shape.cx - hx, maxX: shape.cx + hx, minY: shape.cy - hy, maxY: shape.cy + hy };
    }
    if (!shape.rel || shape.rel.length < 3 || !(shape.scale > 0)) return null;
    return {
      type: "poly",
      mode: mode,
      points: shape.rel.map(function (p) {
        return { x: shape.cx + p.x * shape.scale, y: shape.cy + p.y * shape.scale };
      })
    };
  }

  function geometryStamp(shape) {
    var g = worldGeometry(shape);
    if (!g) return "";
    var body;
    if (g.type === "rect") body = ["rect", g.mode, g.minX.toFixed(4), g.maxX.toFixed(4), g.minY.toFixed(4), g.maxY.toFixed(4)].join("|");
    else if (g.type === "circle") body = ["circle", g.mode, g.cx.toFixed(4), g.cy.toFixed(4), g.r.toFixed(4)].join("|");
    else body = ["poly", g.mode].concat(g.points.map(function (p) { return p.x.toFixed(4) + "," + p.y.toFixed(4); })).join("|");
    var tools = shape.toolScope === "picked" ? ((shape.toolKind || "path") + ":" + (shape.tools || []).join(",")) : "all";
    return body + "|" + tools;
  }

  function shapeSizeValue(shape) {
    if (shape.type === "circle") return Number(shape.diameter);
    if (shape.type === "rect") return shape.hw * 2 * shape.scale;
    return shape.baseWidth * shape.scale;
  }

  function setShapeSize(shape, value) {
    if (!(value > 0)) return;
    if (shape.type === "circle") shape.diameter = value;
    else if (shape.type === "rect") shape.scale = value / (shape.hw * 2);
    else if (shape.baseWidth > 1e-6) shape.scale = value / shape.baseWidth;
  }

  function shapeTitle(shape, index) {
    var kind = shape.type === "rect" ? "Rectangle" : shape.type === "circle" ? "Circle" : "Polygon";
    var keep = shape.mode === "outside" ? "Outside" : "Inside";
    var state = "draft";
    if (shape.applied) state = shape.appliedStamp === geometryStamp(shape) ? "on path" : "moved";
    return (index + 1) + " · " + kind + " · " + keep + " · " + toolCaption(shape) + " · " + state;
  }

  function refreshPatchButtons() {
    var shape = shapes[selectedShape];
    $("patchApply").disabled = !shape || !baseProgram;
    $("patchClear").disabled = !shape;
    $("patchClose").hidden = !(drawTool === "poly" && polyPoints && polyPoints.length >= 3);
    var again = shape && shape.applied && shape.appliedStamp !== geometryStamp(shape);
    $("patchApply").textContent = again ? "Apply again" : "Apply";
    setPressed("patchRect", drawTool === "rect");
    setPressed("patchCircle", drawTool === "circle");
    setPressed("patchPoly", drawTool === "poly");
    stage.classList.toggle("placing", !!drawTool);
  }

  function syncPatchEditors() {
    var panel = $("patchMove");
    var shape = shapes[selectedShape];
    if (!shape) {
      panel.hidden = true;
      refreshPatchButtons();
      return;
    }
    panel.hidden = false;
    $("patchTitle").textContent = shapeTitle(shape, selectedShape);
    var span = workSpan();
    var size = shapeSizeValue(shape);
    var sizeMax = Math.max(span.maxX - span.minX, span.maxY - span.minY, size, 10);
    patchLock = true;
    $("patchMode").value = shape.mode === "outside" ? "outside" : "inside";
    $("patchX").min = span.minX;
    $("patchX").max = span.maxX;
    $("patchY").min = span.minY;
    $("patchY").max = span.maxY;
    $("patchSize").min = 0.2;
    $("patchSize").max = sizeMax;
    $("patchX").value = shape.cx;
    $("patchY").value = shape.cy;
    $("patchSize").value = size;
    if (document.activeElement !== $("patchXNum")) $("patchXNum").value = Number(shape.cx).toFixed(3);
    if (document.activeElement !== $("patchYNum")) $("patchYNum").value = Number(shape.cy).toFixed(3);
    if (document.activeElement !== $("patchSizeNum")) $("patchSizeNum").value = Number(size).toFixed(3);
    patchLock = false;
    restoreToolChecks();
    refreshPatchButtons();
  }

  function jobTargets(prog) {
    var paths = prog.meta && prog.meta.toolpaths ? prog.meta.toolpaths : [];
    if (paths.length) {
      return paths.map(function (tp) {
        return {
          kind: "path",
          id: tp.number,
          name: tp.name || ("Toolpath " + tp.number),
          startTime: tp.startTime
        };
      });
    }
    var seen = [];
    for (var i = 0; i < prog.n; i++) {
      var tool = prog.tool[i];
      if (tool > 0 && seen.indexOf(tool) < 0) seen.push(tool);
    }
    seen.sort(function (a, b) { return a - b; });
    return seen.map(function (tool) {
      var start = null;
      for (var s = 0; s < prog.n; s++) {
        if (prog.tool[s] === tool) {
          start = s === 0 ? 0 : prog.tEnd[s - 1];
          break;
        }
      }
      return { kind: "tool", id: tool, name: "T" + tool, startTime: start };
    });
  }

  function readPicked() {
    var ids = [];
    var labels = [];
    var kind = "path";
    var boxes = document.querySelectorAll("#paths .pathpick");
    for (var i = 0; i < boxes.length; i++) {
      if (!boxes[i].checked) continue;
      ids.push(Number(boxes[i].dataset.id));
      labels.push(boxes[i].dataset.label || "");
      kind = boxes[i].dataset.kind || kind;
    }
    return { ids: ids, labels: labels, kind: kind };
  }

  function assignTools(shape) {
    var picked = readPicked();
    shape.toolScope = $("patchScope").value === "picked" ? "picked" : "all";
    shape.toolKind = picked.kind;
    shape.tools = picked.ids.slice();
    shape.toolLabel = picked.labels.join(", ");
  }

  function toolCaption(shape) {
    if (!shape || shape.toolScope !== "picked" || !shape.tools || !shape.tools.length) return "All tools";
    if (shape.tools.length === 1) return shape.toolLabel || String(shape.tools[0]);
    return shape.tools.length + " tools";
  }

  function restoreToolChecks() {
    var shape = shapes[selectedShape];
    if (!shape || !$("patchScope")) return;
    toolCheckLock = true;
    $("patchScope").value = shape.toolScope === "picked" ? "picked" : "all";
    var ids = shape.toolScope === "picked" && shape.tools ? shape.tools : [];
    var boxes = document.querySelectorAll("#paths .pathpick");
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].checked = ids.indexOf(Number(boxes[i].dataset.id)) >= 0;
    }
    toolCheckLock = false;
  }

  function onToolPick() {
    if (toolCheckLock) return;
    var picked = readPicked();
    if (picked.ids.length) $("patchScope").value = "picked";
    var shape = shapes[selectedShape];
    if (!shape) return;
    assignTools(shape);
    var row = $("patchList").querySelectorAll("button")[selectedShape];
    if (row) row.textContent = shapeTitle(shape, selectedShape);
    $("patchTitle").textContent = shapeTitle(shape, selectedShape);
    refreshPatchButtons();
    dirty = true;
  }

  function renderPatchList() {
    var list = $("patchList");
    list.innerHTML = "";
    shapes.forEach(function (shape, i) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = i === selectedShape ? "on" : "";
      btn.textContent = shapeTitle(shape, i);
      btn.addEventListener("click", function () {
        selectedShape = i;
        renderPatchList();
        dirty = true;
      });
      list.appendChild(btn);
    });
    syncPatchEditors();
  }

  function armDraw(tool) {
    if (tool && !baseProgram) {
      setStatus("Open a program, then draw the shape on the view.");
      return;
    }
    drawTool = tool || null;
    polyPoints = drawTool === "poly" ? [] : null;
    polyCursor = null;
    rubber = null;
    if (drawTool) {
      cam.mode = "top";
      setPressed("viewTop", true);
      setPressed("viewIso", false);
      setStatus(drawTool === "poly" ? "Click each corner of the polygon. The path stays as it is until Apply." : "Drag the shape on the top view. The path stays as it is until Apply.");
    }
    refreshPatchButtons();
    dirty = true;
  }

  function selectNewShape(shape) {
    assignTools(shape);
    shapes.push(shape);
    selectedShape = shapes.length - 1;
    drawTool = null;
    polyPoints = null;
    polyCursor = null;
    rubber = null;
    renderPatchList();
    setStatus("The shape is a draft. Move it if you want, then press Apply to change this path.");
    dirty = true;
  }

  function addPolyPoint(pt) {
    if (!polyPoints) polyPoints = [];
    if (polyPoints.length >= 3) {
      var first = polyPoints[0];
      var rect = stage.getBoundingClientRect();
      var tol = Math.max(0.8, 14 * cam.viewH / Math.max(1, rect.height));
      if (Math.hypot(pt.x - first.x, pt.y - first.y) <= tol) {
        finishPolygon();
        return;
      }
    }
    if (polyPoints.length) {
      var last = polyPoints[polyPoints.length - 1];
      if (Math.hypot(pt.x - last.x, pt.y - last.y) < 0.3) return;
    }
    polyPoints.push({ x: pt.x, y: pt.y });
    refreshPatchButtons();
    dirty = true;
  }

  function finishPolygon() {
    if (!polyPoints || polyPoints.length < 3) return;
    var cx = 0;
    var cy = 0;
    polyPoints.forEach(function (p) { cx += p.x; cy += p.y; });
    cx /= polyPoints.length;
    cy /= polyPoints.length;
    var rel = polyPoints.map(function (p) { return { x: p.x - cx, y: p.y - cy }; });
    var minX = Infinity;
    var maxX = -Infinity;
    rel.forEach(function (p) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
    });
    selectNewShape({
      type: "poly",
      mode: "inside",
      cx: cx,
      cy: cy,
      scale: 1,
      rel: rel,
      baseWidth: Math.max(0.2, maxX - minX),
      applied: false,
      appliedStamp: ""
    });
  }

  function finishRubber() {
    var band = rubber;
    rubber = null;
    if (!band) return;
    var x0 = band.x0;
    var y0 = band.y0;
    var x1 = band.x1;
    var y1 = band.y1;
    if (band.type === "circle") {
      var diameter = Math.hypot(x1 - x0, y1 - y0) * 2;
      if (diameter < 0.4) return;
      selectNewShape({
        type: "circle",
        mode: "inside",
        cx: x0,
        cy: y0,
        diameter: diameter,
        applied: false,
        appliedStamp: ""
      });
      return;
    }
    var hw = Math.abs(x1 - x0) / 2;
    var hh = Math.abs(y1 - y0) / 2;
    if (hw < 0.2 || hh < 0.2) return;
    selectNewShape({
      type: "rect",
      mode: "inside",
      cx: (x0 + x1) / 2,
      cy: (y0 + y1) / 2,
      hw: hw,
      hh: hh,
      scale: 1,
      applied: false,
      appliedStamp: ""
    });
  }

  function shapeAt(x, y) {
    for (var i = shapes.length - 1; i >= 0; i--) {
      var g = worldGeometry(shapes[i]);
      if (g && Makera.shapeContains(g, x, y)) return i;
    }
    return -1;
  }

  function moveShape(kind, raw) {
    var shape = shapes[selectedShape];
    if (!shape || patchLock) return;
    if (raw === "" || raw === "-" || raw === "." || raw === "-.") return;
    var n = Number(raw);
    if (!isFinite(n)) return;
    if (kind === "x") shape.cx = n;
    else if (kind === "y") shape.cy = n;
    else setShapeSize(shape, n);
    var row = $("patchList").querySelectorAll("button")[selectedShape];
    if (row) row.textContent = shapeTitle(shape, selectedShape);
    $("patchTitle").textContent = shapeTitle(shape, selectedShape);
    patchLock = true;
    if (kind === "x") {
      if (n < Number($("patchX").min)) $("patchX").min = String(n);
      if (n > Number($("patchX").max)) $("patchX").max = String(n);
      $("patchX").value = String(n);
      if (document.activeElement !== $("patchXNum")) $("patchXNum").value = n.toFixed(3);
    } else if (kind === "y") {
      if (n < Number($("patchY").min)) $("patchY").min = String(n);
      if (n > Number($("patchY").max)) $("patchY").max = String(n);
      $("patchY").value = String(n);
      if (document.activeElement !== $("patchYNum")) $("patchYNum").value = n.toFixed(3);
    } else {
      if (n > Number($("patchSize").max)) $("patchSize").max = String(n);
      $("patchSize").value = String(n);
      if (document.activeElement !== $("patchSizeNum")) $("patchSizeNum").value = n.toFixed(3);
    }
    patchLock = false;
    refreshPatchButtons();
    dirty = true;
  }

  function patchGeometry(shape) {
    var geom = worldGeometry(shape);
    if (!geom) return null;
    if (shape.toolScope === "picked" && shape.tools && shape.tools.length) {
      geom.tools = shape.tools.slice();
      geom.toolKind = shape.toolKind || "path";
      geom.toolLabel = shape.toolLabel || "";
    }
    return geom;
  }

  function appliedGeometries() {
    var active = [];
    shapes.forEach(function (shape) {
      if (!shape.applied) return;
      var geom = patchGeometry(shape);
      if (geom) active.push(geom);
    });
    return active;
  }

  function restoreBase(note) {
    sourceText = baseText;
    sourceName = baseName;
    program = baseProgram;
    sourceIsPatch = false;
    if (renderer) uploadPath();
    fillJob(note);
    setBusy(false);
    dirty = true;
  }

  async function installPatch(text, note) {
    var token = ++loadToken;
    setBusy(true, "Plotting the patched path", 0, "");
    var parsed;
    try {
      parsed = await Makera.parseProgram(text, function (ratio, moves) {
        if (token !== loadToken) return;
        setBusy(true, "Plotting the patched path", ratio, moves.toLocaleString("en-US") + " moves");
      });
    } catch (err) {
      setBusy(false);
      setStatus("Could not build the patched path.");
      return;
    }
    if (token !== loadToken) return;
    if (!parsed.n) {
      setBusy(false);
      setStatus("That would remove every cut, so the path was left as it is.");
      return;
    }
    sourceText = text;
    program = parsed;
    sourceIsPatch = true;
    if (!renderer) renderer = createRenderer();
    resize();
    if (renderer) uploadPath();
    fillJob(note);
    setBusy(false);
    dirty = true;
  }

  async function recomputeApplied(note) {
    if (!baseProgram) return;
    var active = appliedGeometries();
    if (!active.length) {
      if (sourceIsPatch) restoreBase(note || "The path is back to the loaded file.");
      else setStatus(note || "The path is the loaded file.");
      return;
    }
    playing = false;
    paintPlay();
    setBusy(true, "Updating the path", 0.2, "");
    await new Promise(function (resolve) { setTimeout(resolve, 30); });
    var result = Makera.buildPatch(baseText, baseProgram, active, baseName);
    if (result.empty || !result.changed) {
      if (sourceIsPatch) restoreBase(result.summary);
      else {
        setBusy(false);
        setStatus(result.summary);
      }
      return;
    }
    await installPatch(result.content, result.summary);
  }

  async function applyPatch() {
    var shape = shapes[selectedShape];
    if (!shape || !baseProgram) return;
    assignTools(shape);
    if (shape.toolScope === "picked" && (!shape.tools || !shape.tools.length)) {
      setStatus("Check one or more tools in the job list, or set Tools to All tools.");
      return;
    }
    if (!worldGeometry(shape)) {
      setStatus("The shape needs a size greater than 0.");
      return;
    }
    var wasApplied = !!shape.applied;
    var oldStamp = shape.appliedStamp || "";
    shape.applied = true;
    var active = appliedGeometries();
    playing = false;
    paintPlay();
    setBusy(true, "Applying the shape", 0.15, "");
    await new Promise(function (resolve) { setTimeout(resolve, 40); });
    var result;
    try {
      result = Makera.buildPatch(baseText, baseProgram, active, baseName);
    } catch (err) {
      shape.applied = wasApplied;
      shape.appliedStamp = oldStamp;
      setBusy(false);
      setStatus(err && err.message ? err.message : "Could not apply that shape.");
      return;
    }
    if (result.empty) {
      shape.applied = wasApplied;
      shape.appliedStamp = oldStamp;
      renderPatchList();
      setBusy(false);
      setStatus(result.summary);
      return;
    }
    shape.appliedStamp = geometryStamp(shape);
    renderPatchList();
    if (!result.changed) {
      if (sourceIsPatch) restoreBase(result.summary);
      else {
        setBusy(false);
        setStatus(result.summary);
      }
      return;
    }
    await installPatch(result.content, result.summary);
  }

  function clearSelectedShape() {
    if (selectedShape < 0 || selectedShape >= shapes.length) return;
    var wasApplied = !!shapes[selectedShape].applied;
    shapes.splice(selectedShape, 1);
    selectedShape = Math.min(selectedShape, shapes.length - 1);
    renderPatchList();
    dirty = true;
    if (wasApplied) recomputeApplied("That shape is off the path.");
    else setStatus("The draft is gone. The path was not changed.");
  }

  function traceWorld(ctx, points, m, surface) {
    var started = false;
    for (var i = 0; i < points.length; i++) {
      var p = project(points[i].x, points[i].y, surface, m);
      if (!p) continue;
      if (!started) {
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]);
        started = true;
      } else ctx.lineTo(p[0], p[1]);
    }
    return started;
  }

  function shapeOutline(shape) {
    var g = worldGeometry(shape);
    if (!g) return null;
    if (g.type === "rect") {
      return [
        { x: g.minX, y: g.minY },
        { x: g.maxX, y: g.minY },
        { x: g.maxX, y: g.maxY },
        { x: g.minX, y: g.maxY },
        { x: g.minX, y: g.minY }
      ];
    }
    if (g.type === "poly") {
      var pts = g.points.slice();
      pts.push(g.points[0]);
      return pts;
    }
    var ring = [];
    for (var s = 0; s <= 64; s++) {
      var a = (s / 64) * Math.PI * 2;
      ring.push({ x: g.cx + Math.cos(a) * g.r, y: g.cy + Math.sin(a) * g.r });
    }
    return ring;
  }

  function drawShapes(ctx, m, dpr) {
    var surface = surfaceZ();
    ctx.save();
    ctx.lineJoin = "round";
    ctx.font = (12 * dpr) + "px Bahnschrift, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    function strokeOutline(points, selected, pending) {
      if (!traceWorld(ctx, points, m, surface)) return;
      ctx.closePath();
      ctx.lineWidth = (selected ? 2.4 : 1.5) * dpr;
      ctx.strokeStyle = selected ? "#f0a202" : "rgba(244, 239, 228, 0.85)";
      ctx.setLineDash(pending ? [6 * dpr, 4 * dpr] : []);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (var i = 0; i < shapes.length; i++) {
      var outline = shapeOutline(shapes[i]);
      if (!outline) continue;
      var pending = !shapes[i].applied || shapes[i].appliedStamp !== geometryStamp(shapes[i]);
      strokeOutline(outline, i === selectedShape, pending);
      var center = project(shapes[i].cx, shapes[i].cy, surface, m);
      if (center) {
        ctx.fillStyle = i === selectedShape ? "#f0a202" : "#f4efe4";
        ctx.fillText((i + 1) + " " + (shapes[i].mode === "outside" ? "out" : "in"), center[0], center[1]);
      }
    }
    if (rubber) {
      var ghost = rubber.type === "circle"
        ? shapeOutline({ type: "circle", mode: "inside", cx: rubber.x0, cy: rubber.y0, diameter: Math.hypot(rubber.x1 - rubber.x0, rubber.y1 - rubber.y0) * 2 })
        : shapeOutline({
          type: "rect",
          mode: "inside",
          cx: (rubber.x0 + rubber.x1) / 2,
          cy: (rubber.y0 + rubber.y1) / 2,
          hw: Math.abs(rubber.x1 - rubber.x0) / 2,
          hh: Math.abs(rubber.y1 - rubber.y0) / 2,
          scale: 1
        });
      if (ghost) strokeOutline(ghost, true, true);
    }
    if (polyPoints && polyPoints.length) {
      var open = polyPoints.slice();
      if (polyCursor) open.push(polyCursor);
      if (traceWorld(ctx, open, m, surface)) {
        ctx.lineWidth = 2 * dpr;
        ctx.strokeStyle = "#f0a202";
        ctx.setLineDash([6 * dpr, 4 * dpr]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.restore();
  }

  fillDrillSizes();
  $("patchRect").addEventListener("click", function () { armDraw(drawTool === "rect" ? null : "rect"); });
  $("patchCircle").addEventListener("click", function () { armDraw(drawTool === "circle" ? null : "circle"); });
  $("patchPoly").addEventListener("click", function () { armDraw(drawTool === "poly" ? null : "poly"); });
  $("patchClose").addEventListener("click", finishPolygon);
  $("patchApply").addEventListener("click", applyPatch);
  $("patchClear").addEventListener("click", clearSelectedShape);
  $("patchScope").addEventListener("change", function () {
    if (patchLock || toolCheckLock) return;
    var shape = shapes[selectedShape];
    if (!shape) return;
    assignTools(shape);
    var row = $("patchList").querySelectorAll("button")[selectedShape];
    if (row) row.textContent = shapeTitle(shape, selectedShape);
    $("patchTitle").textContent = shapeTitle(shape, selectedShape);
    refreshPatchButtons();
    dirty = true;
  });
  $("patchMode").addEventListener("change", function () {
    var shape = shapes[selectedShape];
    if (!shape || patchLock) return;
    shape.mode = $("patchMode").value === "outside" ? "outside" : "inside";
    renderPatchList();
    dirty = true;
  });
  $("patchX").addEventListener("input", function () { moveShape("x", $("patchX").value); });
  $("patchY").addEventListener("input", function () { moveShape("y", $("patchY").value); });
  $("patchSize").addEventListener("input", function () { moveShape("size", $("patchSize").value); });
  $("patchXNum").addEventListener("input", function () { moveShape("x", $("patchXNum").value); });
  $("patchYNum").addEventListener("input", function () { moveShape("y", $("patchYNum").value); });
  $("patchSizeNum").addEventListener("input", function () { moveShape("size", $("patchSizeNum").value); });
  $("placeHole").addEventListener("click", addHole);
  $("holeX").addEventListener("input", function () { moveSelected("x", $("holeX").value); });
  $("holeY").addEventListener("input", function () { moveSelected("y", $("holeY").value); });
  $("holeXNum").addEventListener("input", function () { moveSelected("x", $("holeXNum").value); });
  $("holeYNum").addEventListener("input", function () { moveSelected("y", $("holeYNum").value); });
  $("drillSize").addEventListener("change", function () {
    if ($("drillSize").value !== "custom") $("drillDia").value = $("drillSize").value;
    commitSettings();
  });
  $("drillDia").addEventListener("input", function () {
    syncSizeSelect();
    commitSettings();
  });
  ["drillDepth", "drillPeck", "drillFeed", "drillSpindle", "drillTool"].forEach(function (id) {
    $(id).addEventListener("input", commitSettings);
  });
  $("drillThrough").addEventListener("change", applyThrough);
  $("holeClear").addEventListener("click", removeSelectedHole);
  var threadFormLock = false;

  function threadById(id) {
    for (var i = 0; i < Makera.threads.length; i++) {
      if (Makera.threads[i].id === id) return Makera.threads[i];
    }
    return null;
  }

  function suggestedThreadDepth(hole, pitch) {
    var depth = Number(hole.depth) || pitch;
    if (hole.through) return depth;
    var shorter = depth - Math.max(pitch, 0.3);
    if (!(shorter >= pitch)) return depth;
    return Math.round(shorter * 1000) / 1000;
  }

  function threadsForDiameter(diameter) {
    var dia = Number(diameter);
    var list = [];
    Makera.threads.forEach(function (t) {
      if (Math.abs(t.pilot - dia) <= 0.06) list.push(t);
    });
    list.sort(function (a, b) {
      return Math.abs(a.pilot - dia) - Math.abs(b.pilot - dia);
    });
    return list;
  }

  function nearestPreset(diameter) {
    var best = Makera.threads[0];
    var gap = Infinity;
    Makera.threads.forEach(function (t) {
      var distance = Math.abs(t.pilot - Number(diameter));
      if (distance < gap) {
        best = t;
        gap = distance;
      }
    });
    return best;
  }

  function fillThreadPresets(diameter) {
    var sel = $("threadPreset");
    sel.innerHTML = "";
    threadsForDiameter(diameter).forEach(function (t) {
      var opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.name;
      sel.appendChild(opt);
    });
    var custom = document.createElement("option");
    custom.value = "custom";
    custom.textContent = "Custom";
    sel.appendChild(custom);
  }

  function selectPreset(id) {
    var sel = $("threadPreset");
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === id) {
        sel.value = id;
        return;
      }
    }
    sel.value = "custom";
  }

  function writeThreadFields(values) {
    threadFormLock = true;
    selectPreset(values.preset || "custom");
    $("threadMajor").value = values.major;
    $("threadPitch").value = values.pitch;
    $("threadPilot").value = values.pilot;
    $("threadDepth").value = values.depth;
    $("threadMill").value = values.millDia;
    $("threadTool").value = values.tool;
    $("threadFeed").value = values.feed;
    $("threadSpindle").value = values.spindle;
    threadFormLock = false;
  }

  function valuesFromPreset(preset, hole) {
    return {
      preset: preset.id,
      name: preset.name,
      major: preset.major,
      pitch: preset.pitch,
      pilot: preset.pilot,
      depth: suggestedThreadDepth(hole, preset.pitch),
      millDia: Makera.threadMillDiameter(preset.pilot),
      tool: Math.max(1, Math.round(Number(hole.tool) || 1) + 1),
      feed: 200,
      spindle: Number(hole.spindle) || 12000
    };
  }

  function presetForNumbers(major, pitch, pilot) {
    for (var i = 0; i < Makera.threads.length; i++) {
      var t = Makera.threads[i];
      if (Math.abs(t.major - major) < 0.001 && Math.abs(t.pitch - pitch) < 0.001 && Math.abs(t.pilot - pilot) < 0.001) return t;
    }
    return null;
  }

  function refreshThreadNote() {
    var h = holes[selectedHole];
    if (!h) return;
    var pilot = Number($("threadPilot").value);
    var mill = Number($("threadMill").value);
    var major = Number($("threadMajor").value);
    var tool = Math.round(Number($("threadTool").value));
    var parts = [];
    parts.push("Hole " + (selectedHole + 1) + " is drilled at " + Makera.fmt(h.diameter) + " mm with T" + h.tool + ". That drill only makes the pilot.");
    if (!threadsForDiameter(h.diameter).length) {
      var near = nearestPreset(h.diameter);
      parts.push("No standard thread uses this pilot. The nearest is " + near.name + ", which is drilled at " + Makera.fmt(near.pilot) + " mm.");
    }
    if (pilot > 0 && Math.abs(pilot - Number(h.diameter)) > 0.05) {
      parts.push("The usual pilot for this thread is " + Makera.fmt(pilot) + " mm.");
    }
    if (!(mill > 0) || mill >= Number(h.diameter) - 0.05) {
      parts.push("The thread mill has to be smaller than the drilled hole so it can drop into the center.");
    } else if (major > mill) {
      parts.push("The mill orbits " + Makera.fmt((major - mill) / 2) + " mm from the center, and its edge cuts the " + Makera.fmt(major) + " mm thread.");
    }
    if (tool === Math.round(Number(h.tool))) parts.push("Give the thread mill a different tool number than the drill.");
    $("threadNote").textContent = parts.join(" ");
  }

  function openThread() {
    var h = holes[selectedHole];
    if (!h) return;
    hideHint();
    var matches = threadsForDiameter(h.diameter);
    fillThreadPresets(h.diameter);
    $("threadTitle").textContent = "Thread hole " + (selectedHole + 1);
    if (h.thread) {
      var match = presetForNumbers(Number(h.thread.major), Number(h.thread.pitch), Number(h.thread.pilot));
      writeThreadFields({
        preset: match ? match.id : "custom",
        major: h.thread.major,
        pitch: h.thread.pitch,
        pilot: h.thread.pilot,
        depth: h.thread.depth,
        millDia: h.thread.millDia,
        tool: h.thread.tool,
        feed: h.thread.feed,
        spindle: h.thread.spindle
      });
    } else if (matches.length) {
      writeThreadFields(valuesFromPreset(matches[0], h));
    } else {
      var near = valuesFromPreset(nearestPreset(h.diameter), h);
      near.preset = "custom";
      writeThreadFields(near);
    }
    $("threadScrim").hidden = false;
    refreshThreadNote();
  }

  function closeThread() {
    $("threadScrim").hidden = true;
    hideHint();
  }

  function applyThreadPreset() {
    if (threadFormLock) return;
    var preset = threadById($("threadPreset").value);
    var h = holes[selectedHole];
    if (!preset || !h) {
      refreshThreadNote();
      return;
    }
    var next = valuesFromPreset(preset, h);
    var tool = Number($("threadTool").value);
    var feed = Number($("threadFeed").value);
    var spindle = Number($("threadSpindle").value);
    if (tool >= 1) next.tool = tool;
    if (feed > 0) next.feed = feed;
    if (spindle > 0) next.spindle = spindle;
    writeThreadFields(next);
    refreshThreadNote();
  }

  function markThreadCustom() {
    if (threadFormLock) return;
    var match = presetForNumbers(Number($("threadMajor").value), Number($("threadPitch").value), Number($("threadPilot").value));
    selectPreset(match ? match.id : "custom");
    refreshThreadNote();
  }

  function readThreadForm() {
    var major = Number($("threadMajor").value);
    var pitch = Number($("threadPitch").value);
    var pilot = Number($("threadPilot").value);
    var match = presetForNumbers(major, pitch, pilot);
    return {
      name: match ? match.name : "Custom",
      preset: match ? match.id : "custom",
      major: major,
      pitch: pitch,
      pilot: pilot,
      depth: Number($("threadDepth").value),
      millDia: Number($("threadMill").value),
      feed: Number($("threadFeed").value),
      spindle: Number($("threadSpindle").value),
      tool: Math.round(Number($("threadTool").value))
    };
  }

  function saveThread() {
    var h = holes[selectedHole];
    if (!h) return;
    var previous = h.thread || null;
    h.thread = readThreadForm();
    try {
      Makera.buildDrill(drillSpec());
    } catch (err) {
      h.thread = previous;
      $("threadNote").textContent = err && err.message ? err.message : "Check the thread numbers.";
      return;
    }
    paintHoleRow(selectedHole);
    $("threadOpen").textContent = "Thread · " + h.thread.name;
    dirty = true;
    closeThread();
    setStatus("Hole " + (selectedHole + 1) + " keeps an " + h.thread.name + " thread. The drill file makes the pilot first, then cuts the thread with the other bit.");
  }

  function removeThread() {
    var h = holes[selectedHole];
    if (!h) return;
    h.thread = null;
    paintHoleRow(selectedHole);
    $("threadOpen").textContent = "Thread this hole";
    dirty = true;
    closeThread();
  }

  function useThreadPilot() {
    var h = holes[selectedHole];
    var pilot = Number($("threadPilot").value);
    if (!h || !(pilot > 0)) return;
    h.diameter = pilot;
    loadSettings(h);
    commitSettings();
    var kept = readThreadForm();
    fillThreadPresets(h.diameter);
    var match = presetForNumbers(kept.major, kept.pitch, kept.pilot);
    kept.preset = match ? match.id : "custom";
    writeThreadFields(kept);
    refreshThreadNote();
  }

  $("threadOpen").addEventListener("click", openThread);
  $("threadClose").addEventListener("click", closeThread);
  $("threadScrim").addEventListener("click", function (e) {
    if (e.target === $("threadScrim")) closeThread();
  });
  $("threadPreset").addEventListener("change", applyThreadPreset);
  ["threadMajor", "threadPitch", "threadPilot"].forEach(function (id) {
    $(id).addEventListener("input", markThreadCustom);
  });
  ["threadDepth", "threadMill", "threadTool", "threadFeed", "threadSpindle"].forEach(function (id) {
    $(id).addEventListener("input", refreshThreadNote);
  });
  $("threadUsePilot").addEventListener("click", useThreadPilot);
  $("threadApply").addEventListener("click", saveThread);
  $("threadRemove").addEventListener("click", removeThread);

  $("drillSave").addEventListener("click", async function () {
    try {
      var file = Makera.buildDrill(drillSpec());
      var how = await saveText(file.name, file.content);
      if (how === "cancel") return;
      setStatus("Saved " + file.name + ". " + file.summary);
    } catch (err) {
      setStatus(err && err.message ? err.message : "Could not build the drill file.");
    }
  });

  var hintAnchor = null;
  var hintTimer = 0;

  function hideHint() {
    clearTimeout(hintTimer);
    hintAnchor = null;
    $("hint").hidden = true;
  }

  function placeHint(anchor) {
    var pop = $("hint");
    $("hintTitle").textContent = anchor.getAttribute("data-hint-title") || "";
    $("hintBody").textContent = anchor.getAttribute("data-hint") || "";
    pop.hidden = false;
    var name = anchor.querySelector(".hinted");
    var r = (name || anchor).getBoundingClientRect();
    var box = pop.getBoundingClientRect();
    var left = r.left;
    var roomBelow = window.innerHeight - r.bottom - 12;
    var roomAbove = r.top - 12;
    var top = r.bottom + 8;
    if (box.height > roomBelow && roomAbove > roomBelow) top = r.top - box.height - 8;
    if (left + box.width > window.innerWidth - 10) left = window.innerWidth - box.width - 10;
    if (left < 10) left = 10;
    if (top < 8) top = 8;
    pop.style.left = left + "px";
    pop.style.top = top + "px";
  }

  function armHint(anchor) {
    if (!anchor || anchor === hintAnchor) return;
    clearTimeout(hintTimer);
    hintAnchor = anchor;
    $("hint").hidden = true;
    hintTimer = setTimeout(function () {
      if (hintAnchor === anchor) placeHint(anchor);
    }, 140);
  }

  document.addEventListener("mouseover", function (e) {
    var anchor = e.target.closest ? e.target.closest("[data-hint]") : null;
    if (anchor) armHint(anchor);
    else if (hintAnchor) hideHint();
  });
  document.addEventListener("focusin", function (e) {
    var anchor = e.target.closest ? e.target.closest("[data-hint]") : null;
    if (anchor) armHint(anchor);
  });
  document.addEventListener("focusout", function (e) {
    var next = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest("[data-hint]") : null;
    if (next !== hintAnchor) hideHint();
  });
  window.addEventListener("scroll", function () {
    if (!$("hint").hidden) hideHint();
  }, true);
  window.addEventListener("resize", hideHint);

  window.addEventListener("resize", resize);
  resize();

  function frame(now) {
    requestAnimationFrame(frame);
    var dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
    lastNow = now;
    if (playing && program) {
      simTime += dt * speed;
      if (simTime >= program.totalTime) {
        simTime = program.totalTime;
        playing = false;
        paintPlay();
      }
      dirty = true;
    }
    if (!dirty) return;
    dirty = false;
    resize();
    drawScene();
    if (program) updateReadout();
  }
  requestAnimationFrame(frame);
})();
