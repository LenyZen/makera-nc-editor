/* Makera Z1 NC parser and redo-file builder.
   Coordinates stay in the file's units. Path time uses cutting feed
   and the header rapid rate (default 1200 mm/min). */
(function (root) {
  "use strict";

  var YIELD_EVERY = 32768;

  function makeGrow(Ctor, cap) {
    return { a: new Ctor(cap), n: 0, Ctor: Ctor };
  }

  function push(g, v) {
    if (g.n >= g.a.length) {
      var n = new g.Ctor(g.a.length * 2);
      n.set(g.a);
      g.a = n;
    }
    g.a[g.n++] = v;
  }

  function finish(g) {
    var out = new g.Ctor(g.n);
    if (g.n) out.set(g.a.subarray(0, g.n));
    return out;
  }

  function readNumber(text, i, end) {
    var sign = 1;
    var c0 = text.charCodeAt(i);
    if (c0 === 43) i++;
    else if (c0 === 45) {
      sign = -1;
      i++;
    }
    var intPart = 0;
    var saw = false;
    var c;
    while (i < end) {
      c = text.charCodeAt(i);
      if (c < 48 || c > 57) break;
      saw = true;
      intPart = intPart * 10 + (c - 48);
      i++;
    }
    var frac = 0;
    var scale = 1;
    if (i < end && text.charCodeAt(i) === 46) {
      i++;
      while (i < end) {
        c = text.charCodeAt(i);
        if (c < 48 || c > 57) break;
        saw = true;
        scale *= 10;
        frac = frac * 10 + (c - 48);
        i++;
      }
    }
    if (!saw) return null;
    return { value: sign * (intPart + frac / scale), end: i };
  }

  function parseWords(text, start, end) {
    var w = {
      g: [],
      m: [],
      x: null,
      y: null,
      z: null,
      a: null,
      f: null,
      s: null,
      t: null,
      i: null,
      j: null,
      k: null,
      r: null,
      hasAxis: false
    };
    for (var i = start; i < end; i++) {
      var c = text.charCodeAt(i);
      if (c === 32 || c === 9) continue;
      if (c === 59) break;
      if (c === 40) {
        while (i < end && text.charCodeAt(i) !== 41) i++;
        continue;
      }
      if (c === 47) continue;
      if (c >= 97 && c <= 122) c -= 32;
      if (c < 65 || c > 90) continue;
      var j = i + 1;
      while (j < end && (text.charCodeAt(j) === 32 || text.charCodeAt(j) === 9)) j++;
      var num = readNumber(text, j, end);
      if (!num) continue;
      i = num.end - 1;
      var v = num.value;
      switch (c) {
        case 71: w.g.push(v); break;
        case 77: w.m.push(v); break;
        case 88: w.x = v; w.hasAxis = true; break;
        case 89: w.y = v; w.hasAxis = true; break;
        case 90: w.z = v; w.hasAxis = true; break;
        case 65: w.a = v; w.hasAxis = true; break;
        case 70: w.f = v; break;
        case 83: w.s = v; break;
        case 84: w.t = v; break;
        case 73: w.i = v; break;
        case 74: w.j = v; break;
        case 75: w.k = v; break;
        case 82: w.r = v; break;
        default: break;
      }
    }
    return w;
  }

  function kvFrom(line) {
    var parts = line.split("|");
    var kv = {};
    for (var p = 2; p < parts.length; p++) {
      var eq = parts[p].indexOf("=");
      if (eq > 0) kv[parts[p].slice(0, eq)] = parts[p].slice(eq + 1);
    }
    return { key: parts[1] || "", kv: kv };
  }

  function num(v, fallback) {
    var n = parseFloat(v);
    return isFinite(n) ? n : fallback;
  }

  function findSegment(tEnd, time) {
    var lo = 0;
    var hi = tEnd.length - 1;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (tEnd[mid] < time) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function sampleAt(program, time) {
    var n = program.n;
    if (!n) return null;
    var total = program.totalTime;
    if (time <= 0) {
      return {
        index: 0,
        u: 0,
        time: 0,
        x: program.x[0],
        y: program.y[0],
        z: program.z[0],
        a: program.a ? program.a[0] : 0,
        atStart: true,
        atEnd: false
      };
    }
    if (time >= total) {
      return {
        index: n - 1,
        u: 1,
        time: total,
        x: program.x[n],
        y: program.y[n],
        z: program.z[n],
        a: program.a ? program.a[n] : 0,
        atStart: false,
        atEnd: true
      };
    }
    var i = findSegment(program.tEnd, time);
    var t0 = i === 0 ? 0 : program.tEnd[i - 1];
    var t1 = program.tEnd[i];
    var span = t1 - t0;
    var u = span <= 1e-12 ? 1 : (time - t0) / span;
    if (u < 0) u = 0;
    if (u > 1) u = 1;
    return {
      index: i,
      u: u,
      time: time,
      x: program.x[i] + (program.x[i + 1] - program.x[i]) * u,
      y: program.y[i] + (program.y[i + 1] - program.y[i]) * u,
      z: program.z[i] + (program.z[i + 1] - program.z[i]) * u,
      a: program.a ? program.a[i] + (program.a[i + 1] - program.a[i]) * u : 0,
      atStart: false,
      atEnd: false
    };
  }

  function hypot3(dx, dy, dz) {
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  function segmentLength(program, i) {
    return hypot3(
      program.x[i + 1] - program.x[i],
      program.y[i + 1] - program.y[i],
      program.z[i + 1] - program.z[i]
    );
  }

  function lineGroup(program, i) {
    var s = program.lineStart[i];
    var a = i;
    var b = i;
    while (a > 0 && program.lineStart[a - 1] === s) a--;
    while (b + 1 < program.n && program.lineStart[b + 1] === s) b++;
    return [a, b];
  }

  function remainingFrom(program, sample) {
    var i = sample.index;
    var group = lineGroup(program, i);
    var dist = hypot3(
      program.x[i + 1] - sample.x,
      program.y[i + 1] - sample.y,
      program.z[i + 1] - sample.z
    );
    for (var k = i + 1; k <= group[1]; k++) dist += segmentLength(program, k);
    return { group: group, remaining: dist, multi: group[1] !== group[0] };
  }

  function fmt(n) {
    if (!isFinite(n)) return "0";
    var v = Math.round(n * 1000) / 1000;
    var s = v.toFixed(3);
    s = s.replace(/0+$/, "").replace(/\.$/, "");
    if (s === "-0") s = "0";
    return s;
  }

  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.round(sec);
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    function pad(n) { return n < 10 ? "0" + n : String(n); }
    if (h > 0) return h + ":" + pad(m) + ":" + pad(s);
    return m + ":" + pad(s);
  }

  function redoName(percent) {
    var n = Math.round(percent);
    if (!isFinite(n)) n = 0;
    if (n < 0) n = 0;
    if (n > 100) n = 100;
    return "Makera_" + n + "_redo.NC";
  }

  function extractHeader(text) {
    var key = ";@MKR|END";
    var idx = text.indexOf(key);
    if (idx < 0) return "";
    var end = text.indexOf("\n", idx);
    if (end < 0) return text.slice(0, idx + key.length) + "\r\n";
    return text.slice(0, end + 1);
  }

  function stripThumbnail(body) {
    var marker = ";(thumbnail_image_begin)";
    var at = body.indexOf(marker);
    if (at < 0) return body;
    return body.slice(0, at).replace(/[ \t\r\n]+$/, "") + "\r\n; thumbnail omitted from redo\r\n";
  }

  function entryBlock(clearZ, x, y, z, feed) {
    var nl = "\r\n";
    var lines = [];
    var cut = feed > 1 ? feed : 0;
    var plunge = cut > 1 ? Math.min(cut, 300) : 300;
    var top = Math.max(clearZ, z);
    lines.push("G0 Z" + fmt(top));
    lines.push("G0 X" + fmt(x) + " Y" + fmt(y));
    if (top - z > 0.02) {
      if (cut > 1 && top - z > 0.6 && plunge < cut - 0.1) {
        lines.push("G1 Z" + fmt(z + 0.5) + " F" + fmt(plunge));
        lines.push("G1 Z" + fmt(z) + " F" + fmt(cut));
      } else {
        lines.push("G1 Z" + fmt(z) + " F" + fmt(plunge));
        if (cut > 1 && plunge < cut - 0.1) lines.push("F" + fmt(cut));
      }
    } else if (cut > 1) {
      lines.push("F" + fmt(cut));
    }
    return lines.join(nl) + nl;
  }

  function findToolpathMarker(text, number) {
    var key = ";@MKR|TOOLPATH_START|toolpath_number=" + number;
    var from = 0;
    while (from < text.length) {
      var at = text.indexOf(key, from);
      if (at < 0) return -1;
      var c = text.charCodeAt(at + key.length);
      if (!(c >= 48 && c <= 57)) return at;
      from = at + key.length;
    }
    return -1;
  }

  function lineWords(text, start) {
    var nl = text.indexOf("\n", start);
    if (nl < 0) nl = text.length;
    var end = nl;
    if (end > start && text.charCodeAt(end - 1) === 13) end--;
    return { words: parseWords(text, start, end), next: nl < text.length ? nl + 1 : text.length, end: end };
  }

  function lineNumberAt(text, offset) {
    var n = 1;
    var i = 0;
    var end = offset > text.length ? text.length : (offset > 0 ? offset : 0);
    while (i < end) {
      var nl = text.indexOf("\n", i);
      if (nl < 0 || nl >= end) break;
      n++;
      i = nl + 1;
    }
    return n;
  }

  // True when a short angle index, or a G92 angle reset, happens before Z leaves clearance.
  function angleGate(text, from, clearanceZ, absolute) {
    var i = from;
    var seen = 0;
    while (i < text.length && seen < 80) {
      seen++;
      var row = lineWords(text, i);
      i = row.next;
      var w = row.words;
      if (!w.g.length && w.a == null && w.z == null && w.x == null && w.y == null && !w.m.length && w.t == null && w.s == null) continue;
      var isG92 = false;
      for (var g = 0; g < w.g.length; g++) {
        if (Math.round(w.g[g]) === 92) isG92 = true;
      }
      var drops = false;
      if (w.z != null) {
        if (!absolute) drops = true;
        else if (w.z < clearanceZ - 1) drops = true;
      }
      if (isG92 && w.a != null && !drops) return { ok: true, kind: "g92" };
      if (w.a != null && !drops) {
        if (Math.abs(w.a) > 720) return { ok: false, kind: "long" };
        return { ok: true, kind: "short" };
      }
      if (drops) return { ok: false, kind: "plunge" };
    }
    return { ok: false, kind: "none" };
  }

  function bodyStartsTool(text, from, clearanceZ, absolute) {
    var i = from;
    var seen = 0;
    var sawT = false;
    var sawM6 = false;
    var sawSpin = false;
    while (i < text.length && seen < 80) {
      seen++;
      var row = lineWords(text, i);
      i = row.next;
      var w = row.words;
      if (w.t != null) sawT = true;
      for (var m = 0; m < w.m.length; m++) {
        var mi = Math.round(w.m[m]);
        if (mi === 6) sawM6 = true;
        if (mi === 3 || mi === 4) sawSpin = true;
      }
      if (w.s != null) sawSpin = true;
      var drops = false;
      if (w.z != null) {
        if (!absolute) drops = true;
        else if (w.z < clearanceZ - 1) drops = true;
      }
      if (drops) break;
    }
    return sawT && sawM6 && sawSpin;
  }

  function toolpathAt(program, segIndex) {
    var tps = program.meta && program.meta.toolpaths;
    var found = null;
    if (!tps) return null;
    for (var i = 0; i < tps.length; i++) {
      if (tps[i].startSeg == null) continue;
      if (tps[i].startSeg <= segIndex) found = tps[i];
    }
    return found;
  }

  function planRotaryRedo(text, program, time) {
    var sample = sampleAt(program, Math.min(time, program.totalTime || 0));
    var path = toolpathAt(program, sample.index);
    var minSeg = path && path.startSeg != null ? path.startSeg : 0;
    var lifts = program.lifts;
    if (lifts && lifts.length) {
      var best = -1;
      var lo = 0;
      var hi = lifts.length - 1;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        var seg = lifts[mid];
        var t0 = seg === 0 ? 0 : program.tEnd[seg - 1];
        if (t0 <= time + 1e-4) {
          best = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      for (var i = best; i >= 0; i--) {
        var s = lifts[i];
        if (s < minSeg) break;
        var zEnd = program.z[s + 1];
        var gate = angleGate(text, program.lineStart[s], zEnd, program.absolute[s] !== 0);
        if (!gate.ok) continue;
        var liftWords = lineWords(text, program.lineStart[s]).words;
        var angleOnLift = liftWords.a != null && Math.abs(liftWords.a) <= 720;
        var stateSeg = Math.min(s + 1, program.n - 1);
        return {
          kind: "pass",
          bodyStart: angleOnLift ? program.lineStart[s] : program.lineEnd[s],
          time: program.tEnd[s],
          x: program.x[s + 1],
          y: program.y[s + 1],
          z: zEnd,
          stateSeg: stateSeg
        };
      }
    }

    var startSeg = Math.min(minSeg, Math.max(0, program.n - 1));
    var motionAt = program.n ? program.lineStart[startSeg] : 0;
    var marker = path ? findToolpathMarker(text, path.number) : -1;
    var region = marker >= 0 ? marker : motionAt;
    var bodyStart = region;
    var z0 = program.n ? program.z[startSeg] : 0;
    var absolute = program.n ? program.absolute[startSeg] !== 0 : true;
    if (marker >= 0 && !angleGate(text, marker, z0, absolute).ok) {
      var scan = marker;
      var g92 = -1;
      while (scan < motionAt && scan < text.length) {
        var row = lineWords(text, scan);
        var isG92 = false;
        for (var g = 0; g < row.words.g.length; g++) {
          if (Math.round(row.words.g[g]) === 92 && row.words.a != null) isG92 = true;
        }
        if (isG92) g92 = scan;
        if (row.next <= scan) break;
        scan = row.next;
      }
      if (g92 >= 0) bodyStart = g92;
    }
    var gateB = angleGate(text, bodyStart, z0, absolute);
    var restartTime = 0;
    if (path && path.startTime != null) restartTime = path.startTime;
    else if (startSeg > 0) restartTime = program.tEnd[startSeg - 1];
    if (!gateB.ok && restartTime > 1e-3) return { refused: true };
    return {
      kind: "toolpath",
      bodyStart: bodyStart,
      time: restartTime,
      x: program.n ? program.x[startSeg] : 0,
      y: program.n ? program.y[startSeg] : 0,
      z: z0,
      stateSeg: startSeg,
      refused: false
    };
  }

  function buildRotaryRedo(text, program, time, sourceName) {
    var total = program.totalTime || 0;
    var parked = total > 0 ? (time / total) * 100 : 0;
    var plan = planRotaryRedo(text, program, time);
    if (plan.refused) {
      return {
        refused: true,
        message: "The redo was not saved. Starting at this spot would spin the rotary through the whole angle. Save the full program from the start of the file.",
        name: redoName(0),
        content: "",
        percent: 0,
        parkedPercent: parked
      };
    }
    if (!(plan.time > 1e-3)) {
      return {
        name: redoName(0),
        content: text,
        percent: 0,
        rounded: 0,
        passthrough: true,
        rotaryRewind: true,
        rotaryKind: "full",
        parkedPercent: parked,
        remainingTime: total,
        lineNo: program.n ? program.lineNo[0] : 0,
        x: program.n ? program.x[0] : 0,
        y: program.n ? program.y[0] : 0,
        z: program.n ? program.z[0] : 0,
        tool: program.n ? program.tool[0] : 0,
        feed: program.n ? program.feed[0] : 0,
        spindle: program.n ? program.spindle[0] : 0
      };
    }

    var state = plan.stateSeg;
    var tool = program.tool[state];
    var feed = program.feed[state];
    var spindle = program.spindle[state];
    var spindleCmd = program.spindleCmd[state];
    var coolant = program.coolant[state];
    var absolute = program.absolute[state] !== 0;
    var metric = program.metric[state] !== 0;
    var clear = program.safeZ;
    if (!(clear >= plan.z)) clear = Math.max(plan.z, program.bounds.maxZ);
    if (clear < plan.z) clear = plan.z;
    var bring = bodyStartsTool(text, plan.bodyStart, clear, absolute);
    var nl = "\r\n";
    var code = "";
    code += "G90 " + (metric ? "G21" : "G20") + nl;
    if (!bring) {
      if (tool > 0) code += "T" + tool + " M6" + nl;
      if (coolant === 7) code += "M7" + nl;
      else if (coolant === 8) code += "M8" + nl;
      else if (coolant === 9) code += "M9" + nl;
      if (spindleCmd === 3) code += "S" + Math.round(spindle) + " M3" + nl;
      else if (spindleCmd === 4) code += "S" + Math.round(spindle) + " M4" + nl;
      else code += "M5" + nl;
    }
    code += "G0 Z" + fmt(clear) + nl;
    code += "G0 X" + fmt(plan.x) + " Y" + fmt(plan.y) + nl;
    if (!absolute) code += "G91" + nl;

    var body = stripThumbnail(text.slice(plan.bodyStart));
    if (!/\bM0*2\b/.test(body) && !/\bM30\b/.test(body)) body += "M02\r\n";

    var restartAt = plan.time < time ? plan.time : time;
    var restartPct = total > 0 ? (restartAt / total) * 100 : 0;
    var safeName = String(sourceName || "program.nc").replace(/[\r\n]/g, " ");
    var why = plan.kind === "toolpath"
      ? [
          "; This finish does not come back to an end of X, so the restart is the beginning of that finish.",
          "; The angle reset already in the file runs at clearance, before the cut."
        ]
      : [
          "; Restart is the lifted end of this pass. The percent is earlier than the park.",
          "; The angle is set at clearance, then the file feeds down."
        ];
    var comments = [
      "; REDO",
      "; source: " + safeName,
      "; parked_percent: " + parked.toFixed(1),
      "; restart_percent: " + restartPct.toFixed(1),
      "; resume_line: " + lineNumberAt(text, plan.bodyStart),
      "; resume_position: X" + fmt(plan.x) + " Y" + fmt(plan.y) + " Z" + fmt(clear),
      "; tool: T" + tool + "  spindle: S" + Math.round(spindle) + " M" + spindleCmd + "  feed: F" + fmt(feed),
      "; clearance_z: " + fmt(clear)
    ].concat(why).concat([
      "; Confirm the work origin and the tool in the spindle before running.",
      ""
    ]).join(nl);

    var header = extractHeader(text);
    var content = header + (header && !/\n$/.test(header) ? nl : "") + comments + code + body;
    return {
      name: redoName(restartPct),
      content: content,
      percent: restartPct,
      rounded: Math.round(restartPct),
      passthrough: false,
      rotaryRewind: true,
      rotaryKind: plan.kind,
      parkedPercent: parked,
      remainingTime: Math.max(0, total - restartAt),
      lineNo: lineNumberAt(text, plan.bodyStart),
      x: plan.x,
      y: plan.y,
      z: clear,
      tool: tool,
      feed: feed,
      spindle: spindle,
      spindleCmd: spindleCmd
    };
  }

  function buildRedo(text, program, time, sourceName) {
    var total = program.totalTime || 0;
    var pct = total > 0 ? (time / total) * 100 : 0;
    var name = redoName(pct);
    if (!(time > 1e-3)) {
      return {
        name: name,
        content: text,
        percent: 0,
        rounded: 0,
        passthrough: true,
        remainingTime: total,
        lineNo: program.n ? program.lineNo[0] : 0,
        x: program.n ? program.x[0] : 0,
        y: program.n ? program.y[0] : 0,
        z: program.n ? program.z[0] : 0,
        tool: program.n ? program.tool[0] : 0,
        feed: program.n ? program.feed[0] : 0,
        spindle: program.n ? program.spindle[0] : 0
      };
    }

    if (program.rotary && program.a) return buildRotaryRedo(text, program, time, sourceName);

    var sample = sampleAt(program, Math.min(time, total));
    var info = remainingFrom(program, sample);
    var i = sample.index;
    var group = info.group;
    var nearlyDone = info.remaining <= 0.05;
    var traveled = 0;
    for (var t = group[0]; t < i; t++) traveled += segmentLength(program, t);
    traveled += hypot3(
      sample.x - program.x[i],
      sample.y - program.y[i],
      sample.z - program.z[i]
    );
    var barelyStarted = traveled <= 0.05;

    var stateIndex = i;
    if (nearlyDone && i + 1 < program.n) stateIndex = i + 1;
    var tool = program.tool[stateIndex];
    var feed = program.feed[stateIndex];
    var spindle = program.spindle[stateIndex];
    var spindleCmd = program.spindleCmd[stateIndex];
    var coolant = program.coolant[stateIndex];
    var absolute = program.absolute[stateIndex] !== 0;
    var metric = program.metric[stateIndex] !== 0;
    var lineNo = program.lineNo[i];

    var bodyStart;
    var extra = "";
    if (info.multi && !barelyStarted && !nearlyDone) {
      var bits = [];
      var cx = sample.x;
      var cy = sample.y;
      var cz = sample.z;
      var cut = feed > 1 ? feed : 300;
      for (var k = i; k <= group[1]; k++) {
        var ex = program.x[k + 1];
        var ey = program.y[k + 1];
        var ez = program.z[k + 1];
        if (hypot3(ex - cx, ey - cy, ez - cz) < 0.02) continue;
        bits.push("G1 X" + fmt(ex) + " Y" + fmt(ey) + " Z" + fmt(ez) + " F" + fmt(cut));
        cx = ex;
        cy = ey;
        cz = ez;
      }
      if (bits.length) extra = "; arc remainder as straight moves\r\n" + bits.join("\r\n") + "\r\n";
      bodyStart = program.lineEnd[group[1]];
    } else if (nearlyDone) {
      bodyStart = program.lineEnd[group[1]];
    } else {
      bodyStart = program.lineStart[group[0]];
    }

    var body = stripThumbnail(text.slice(bodyStart));
    if (!/\bM0*2\b/.test(body) && !/\bM30\b/.test(body)) body += "M02\r\n";

    var clear = program.safeZ;
    if (!(clear >= sample.z)) clear = Math.max(sample.z, program.bounds.maxZ);
    if (clear < sample.z) clear = sample.z;

    var nl = "\r\n";
    var safeName = String(sourceName || "program.nc").replace(/[\r\n]/g, " ");
    var comments = [
      "; REDO",
      "; source: " + safeName,
      "; resume_percent: " + pct.toFixed(1),
      "; resume_time: " + formatTime(time) + " of " + formatTime(total),
      "; resume_line: " + lineNo,
      "; resume_position: X" + fmt(sample.x) + " Y" + fmt(sample.y) + " Z" + fmt(sample.z),
      "; tool: T" + tool + "  spindle: S" + Math.round(spindle) + " M" + spindleCmd + "  feed: F" + fmt(feed),
      "; clearance_z: " + fmt(clear),
      "; Raises to clearance, moves to the restart XY, then feeds down.",
      "; Confirm the work origin and the tool in the spindle before running.",
      ""
    ].join(nl);

    var code = "";
    code += "G90 " + (metric ? "G21" : "G20") + nl;
    if (tool > 0) code += "T" + tool + " M6" + nl;
    if (coolant === 7) code += "M7" + nl;
    else if (coolant === 8) code += "M8" + nl;
    else if (coolant === 9) code += "M9" + nl;
    if (spindleCmd === 3) code += "S" + Math.round(spindle) + " M3" + nl;
    else if (spindleCmd === 4) code += "S" + Math.round(spindle) + " M4" + nl;
    else code += "M5" + nl;
    code += entryBlock(clear, sample.x, sample.y, sample.z, feed);
    if (!absolute) code += "G91" + nl;

    var header = extractHeader(text);
    var content = header + (header && !/\n$/.test(header) ? nl : "") + comments + code + extra + body;

    return {
      name: name,
      content: content,
      percent: pct,
      rounded: Math.round(pct),
      passthrough: false,
      remainingTime: Math.max(0, total - time),
      lineNo: lineNo,
      x: sample.x,
      y: sample.y,
      z: sample.z,
      tool: tool,
      feed: feed,
      spindle: spindle,
      spindleCmd: spindleCmd
    };
  }

  function adjacentLift(program, time, dir) {
    var lifts = program.lifts;
    if (!lifts || !lifts.length) return null;
    var tEnd = program.tEnd;
    var lo = 0;
    var hi = lifts.length - 1;
    if (dir < 0) {
      var best = -1;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        if (tEnd[lifts[mid]] < time - 1e-4) {
          best = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      return best < 0 ? null : tEnd[lifts[best]];
    }
    var found = -1;
    while (lo <= hi) {
      var m2 = (lo + hi) >> 1;
      if (tEnd[lifts[m2]] > time + 1e-4) {
        found = m2;
        hi = m2 - 1;
      } else lo = m2 + 1;
    }
    return found < 0 ? null : tEnd[lifts[found]];
  }

  function arcDelta(a0, a1, cw) {
    var d = a1 - a0;
    if (cw) {
      if (d >= -1e-9) d -= Math.PI * 2;
    } else if (d <= 1e-9) d += Math.PI * 2;
    return d;
  }

  function emitArc(emit, x0, y0, z0, x1, y1, z1, cw, cx, cy, plane) {
    var a0;
    var a1;
    var radius;
    if (plane === 18) {
      a0 = Math.atan2(z0 - cy, x0 - cx);
      a1 = Math.atan2(z1 - cy, x1 - cx);
      radius = Math.hypot(x0 - cx, z0 - cy);
    } else if (plane === 19) {
      a0 = Math.atan2(z0 - cy, y0 - cx);
      a1 = Math.atan2(z1 - cy, y1 - cx);
      radius = Math.hypot(y0 - cx, z0 - cy);
    } else {
      a0 = Math.atan2(y0 - cy, x0 - cx);
      a1 = Math.atan2(y1 - cy, x1 - cx);
      radius = Math.hypot(x0 - cx, y0 - cy);
    }
    if (!(radius > 1e-6)) {
      emit(x0, y0, z0, x1, y1, z1, false);
      return;
    }
    var delta = arcDelta(a0, a1, cw);
    var length = Math.abs(delta) * radius;
    var steps = Math.max(8, Math.ceil(length / 0.75));
    if (steps > 480) steps = 480;
    var px = x0;
    var py = y0;
    var pz = z0;
    for (var s = 1; s <= steps; s++) {
      var t = s / steps;
      var ang = a0 + delta * t;
      var nx;
      var ny;
      var nz;
      if (plane === 18) {
        nx = s === steps ? x1 : cx + Math.cos(ang) * radius;
        ny = y0 + (y1 - y0) * t;
        nz = s === steps ? z1 : cy + Math.sin(ang) * radius;
      } else if (plane === 19) {
        nx = x0 + (x1 - x0) * t;
        ny = s === steps ? y1 : cx + Math.cos(ang) * radius;
        nz = s === steps ? z1 : cy + Math.sin(ang) * radius;
      } else {
        nx = s === steps ? x1 : cx + Math.cos(ang) * radius;
        ny = s === steps ? y1 : cy + Math.sin(ang) * radius;
        nz = z0 + (z1 - z0) * t;
        if (s === steps) nz = z1;
      }
      emit(px, py, pz, nx, ny, nz, false);
      px = nx;
      py = ny;
      pz = nz;
    }
  }

  function centerFromR(x0, y0, x1, y1, r, cw) {
    var dx = x1 - x0;
    var dy = y1 - y0;
    var d = Math.hypot(dx, dy);
    if (d < 1e-9) return null;
    var rr = Math.abs(r);
    var h2 = rr * rr - (d * d) / 4;
    if (h2 < -1e-4) return null;
    var h = Math.sqrt(Math.max(0, h2));
    var mx = (x0 + x1) / 2;
    var my = (y0 + y1) / 2;
    var nx = dy / d;
    var ny = -dx / d;
    var side = cw ? 1 : -1;
    if (r < 0) side = -side;
    return { cx: mx + nx * h * side, cy: my + ny * h * side };
  }

  async function parseProgram(text, onProgress) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    var meta = {
      machine: "Makera Z1",
      unit: "mm",
      maxFeed: 1200,
      timeSeconds: null,
      material: "",
      stock: null,
      origin: null,
      tools: [],
      toolpaths: []
    };

    var px = makeGrow(Float32Array, 8192);
    var py = makeGrow(Float32Array, 8192);
    var pz = makeGrow(Float32Array, 8192);
    var pa = makeGrow(Float32Array, 8192);
    push(px, 0);
    push(py, 0);
    push(pz, 0);
    push(pa, 0);

    var tEnd = makeGrow(Float64Array, 8192);
    var feedA = makeGrow(Float32Array, 8192);
    var rapidA = makeGrow(Uint8Array, 8192);
    var toolA = makeGrow(Uint16Array, 8192);
    var spindleA = makeGrow(Uint32Array, 8192);
    var spindleCmdA = makeGrow(Uint8Array, 8192);
    var coolantA = makeGrow(Uint8Array, 8192);
    var absoluteA = makeGrow(Uint8Array, 8192);
    var metricA = makeGrow(Uint8Array, 8192);
    var lineNoA = makeGrow(Uint32Array, 8192);
    var lineStartA = makeGrow(Uint32Array, 8192);
    var lineEndA = makeGrow(Uint32Array, 8192);
    var lifts = makeGrow(Uint32Array, 1024);

    var x = 0;
    var y = 0;
    var z = 0;
    var angle = 0;
    var aOffset = 0;
    var axisY = 0;
    var axisZ = 0;
    var segA0 = 0;
    var holdAngle = false;
    var rotaryMove = false;
    var feed = 0;
    var tool = 0;
    var spindle = 0;
    var spindleCmd = 5;
    var coolant = 0;
    var absolute = true;
    var metric = true;
    var plane = 17;
    var modalMotion = null;
    var knowX = false;
    var knowY = false;
    var knowZ = false;
    var armed = false;
    var maxFeed = 1200;
    var safeZ = 0;
    var cutTime = 0;
    var rapidTime = 0;
    var minX = Infinity;
    var minY = Infinity;
    var minZ = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    var maxZ = -Infinity;
    var pendingTp = 0;
    var tpWaiting = false;
    var currentLineStart = 0;
    var currentLineEnd = 0;
    var currentLineNo = 0;

    function touch(xx, yy, zz) {
      if (xx < minX) minX = xx;
      if (yy < minY) minY = yy;
      if (zz < minZ) minZ = zz;
      if (xx > maxX) maxX = xx;
      if (yy > maxY) maxY = yy;
      if (zz > maxZ) maxZ = zz;
    }

    function emit(x0, y0, z0, x1, y1, z1, isRapid) {
      var a0 = segA0;
      var a1 = holdAngle ? segA0 : angle + aOffset;
      var dA = a1 - a0;
      var dist;
      if (Math.abs(dA) < 1e-6) dist = hypot3(x1 - x0, y1 - y0, z1 - z0);
      else {
        var r0 = Math.hypot(y0 - axisY, z0 - axisZ);
        var r1 = Math.hypot(y1 - axisY, z1 - axisZ);
        dist = Math.hypot(x1 - x0, r1 - r0, Math.max(r0, r1) * Math.abs(dA) * Math.PI / 180);
      }
      if (dist < 1e-6) {
        pa.a[tEnd.n] = a1;
        return;
      }
      if (Math.abs(dA) > 1e-4) rotaryMove = true;
      var rate = isRapid ? maxFeed : (feed > 1 ? feed : maxFeed);
      var dt = (dist / rate) * 60;
      var acc = (tEnd.n ? tEnd.a[tEnd.n - 1] : 0) + dt;
      if (isRapid) rapidTime += dt;
      else cutTime += dt;
      if (tpWaiting) {
        var tp = null;
        for (var q = 0; q < meta.toolpaths.length; q++) {
          if (meta.toolpaths[q].number === pendingTp) tp = meta.toolpaths[q];
        }
        if (tp && tp.startSeg == null) tp.startSeg = tEnd.n;
        tpWaiting = false;
      }
      push(px, x1);
      push(py, y1);
      push(pz, z1);
      push(pa, a1);
      push(tEnd, acc);
      push(feedA, feed);
      push(rapidA, isRapid ? 1 : 0);
      push(toolA, tool);
      push(spindleA, spindle);
      push(spindleCmdA, spindleCmd);
      push(coolantA, coolant);
      push(absoluteA, absolute ? 1 : 0);
      push(metricA, metric ? 1 : 0);
      push(lineNoA, currentLineNo);
      push(lineStartA, currentLineStart);
      push(lineEndA, currentLineEnd);
      if (isRapid && z1 > z0 + 0.4) push(lifts, tEnd.n - 1);
      touch(x0, y0, z0);
      touch(x1, y1, z1);
    }

    function handleMkr(line) {
      var parsed = kvFrom(line);
      var key = parsed.key;
      var kv = parsed.kv;
      if (key === "MACHINE") {
        meta.machine = kv.name || kv.id || meta.machine;
      } else if (key === "UNIT") {
        meta.unit = kv.value || meta.unit;
        if (String(kv.value).toLowerCase() === "inch") metric = false;
        else if (String(kv.value).toLowerCase() === "mm") metric = true;
      } else if (key === "MAXFEEDRATE") {
        meta.maxFeed = num(kv.value, meta.maxFeed);
        maxFeed = meta.maxFeed > 1 ? meta.maxFeed : 1200;
      } else if (key === "TIME") {
        meta.timeSeconds = num(kv.seconds, null);
      } else if (key === "MATERIAL") {
        meta.material = [kv.name1, kv.name2, kv.name].filter(Boolean).join(" · ");
      } else if (key === "STOCK") {
        meta.stock = {
          length: num(kv.length, null),
          width: num(kv.width, null),
          height: num(kv.height, null),
          diameter: num(kv.diameter, null)
        };
      } else if (key === "ORIGIN") {
        meta.origin = {
          type: kv.type_name || "",
          x: num(kv.x, 0),
          y: num(kv.y, 0),
          z: num(kv.z, 0)
        };
        axisY = -meta.origin.y;
        axisZ = -meta.origin.z;
      } else if (key === "TOOL") {
        meta.tools.push({
          number: num(kv.number, 0),
          name: kv.name || "",
          diameter: num(kv.diameter, 0),
          type: kv.type || "",
          tipDiameter: num(kv.tipdiameter != null ? kv.tipdiameter : kv.tipDiameter, 0),
          halfAngle: num(kv.halfAngle != null ? kv.halfAngle : kv.halfangle, 0)
        });
      } else if (key === "TOOLPATH") {
        meta.toolpaths.push({
          number: num(kv.number, meta.toolpaths.length + 1),
          tool: num(kv.tool_number, 0),
          name: kv.name || "",
          startSeg: null,
          startTime: null
        });
      } else if (key === "TOOLPATH_START") {
        pendingTp = num(kv.toolpath_number, 0);
        tpWaiting = true;
      }
    }

    var length = text.length;
    var i = 0;
    var lineNo = 0;
    while (i < length) {
      var lineStart = i;
      var nl = text.indexOf("\n", i);
      if (nl < 0) nl = length;
      var end = nl;
      if (end > lineStart && text.charCodeAt(end - 1) === 13) end--;
      var lineEndOffset = nl < length ? nl + 1 : length;
      i = lineEndOffset;
      lineNo++;

      if ((lineNo & (YIELD_EVERY - 1)) === 0 && onProgress) {
        onProgress(lineStart / length, tEnd.n, lineNo);
        await new Promise(function (resolve) { setTimeout(resolve, 0); });
      }

      var p = lineStart;
      while (p < end && (text.charCodeAt(p) === 32 || text.charCodeAt(p) === 9)) p++;
      if (p >= end) continue;
      var c0 = text.charCodeAt(p);
      if (c0 === 37) continue;
      if (c0 === 59) {
        if (p + 5 < end && text.charCodeAt(p + 1) === 64) handleMkr(text.slice(p, end));
        continue;
      }

      var w = parseWords(text, p, end);
      var motion = null;
      var home = false;
      var setPos = false;
      for (var g = 0; g < w.g.length; g++) {
        var gi = Math.round(w.g[g]);
        if (gi === 0 || gi === 1 || gi === 2 || gi === 3) motion = gi;
        else if (gi === 92) setPos = true;
        else if (gi === 90) absolute = true;
        else if (gi === 91) absolute = false;
        else if (gi === 20) metric = false;
        else if (gi === 21) metric = true;
        else if (gi === 17 || gi === 18 || gi === 19) plane = gi;
        else if (gi === 28 || gi === 30) home = true;
      }
      if (motion != null) modalMotion = motion;
      if (w.f != null) feed = w.f;
      if (w.s != null) spindle = w.s;
      if (w.t != null) tool = Math.round(w.t);
      for (var m = 0; m < w.m.length; m++) {
        var mi = Math.round(w.m[m]);
        if (mi === 3 || mi === 4 || mi === 5) spindleCmd = mi;
        else if (mi === 7 || mi === 8 || mi === 9) coolant = mi;
      }

      var a0 = angle;
      if (w.a != null) angle = absolute ? w.a : angle + w.a;

      if (setPos) {
        if (w.x != null) x = absolute ? w.x : x + w.x;
        if (w.y != null) y = absolute ? w.y : y + w.y;
        if (w.z != null) z = absolute ? w.z : z + w.z;
        if (w.a != null) aOffset = (a0 + aOffset) - angle;
        px.a[tEnd.n] = x;
        py.a[tEnd.n] = y;
        pz.a[tEnd.n] = z;
        pa.a[tEnd.n] = angle + aOffset;
        continue;
      }

      if (home || !w.hasAxis) continue;
      var mode = motion != null ? motion : modalMotion;
      if (mode == null) continue;
      segA0 = a0 + aOffset;

      if (w.x != null) knowX = true;
      if (w.y != null) knowY = true;
      if (w.z != null) knowZ = true;
      var hadArm = armed;
      if (knowX && knowY && knowZ) armed = true;

      var nx = x;
      var ny = y;
      var nz = z;
      if (w.x != null) nx = absolute ? w.x : x + w.x;
      if (w.y != null) ny = absolute ? w.y : y + w.y;
      if (w.z != null) nz = absolute ? w.z : z + w.z;
      if (mode === 0) safeZ = Math.max(safeZ, nz);

      currentLineStart = lineStart;
      currentLineEnd = lineEndOffset;
      currentLineNo = lineNo;

      if (!hadArm) {
        x = nx;
        y = ny;
        z = nz;
        if (tEnd.n === 0) {
          px.a[0] = x;
          py.a[0] = y;
          pz.a[0] = z;
          pa.a[0] = angle + aOffset;
        }
        continue;
      }

      if (mode === 2 || mode === 3) {
        var cw = mode === 2;
        var cx = null;
        var cy = null;
        var usePlane = plane;
        if (plane === 18) {
          if (w.i != null || w.k != null) {
            cx = x + (w.i || 0);
            cy = z + (w.k || 0);
          } else if (w.r != null) {
            var c18 = centerFromR(x, z, nx, nz, w.r, cw);
            if (c18) { cx = c18.cx; cy = c18.cy; }
          }
        } else if (plane === 19) {
          if (w.j != null || w.k != null) {
            cx = y + (w.j || 0);
            cy = z + (w.k || 0);
          } else if (w.r != null) {
            var c19 = centerFromR(y, z, ny, nz, w.r, cw);
            if (c19) { cx = c19.cx; cy = c19.cy; }
          }
        } else if (w.i != null || w.j != null) {
          cx = x + (w.i || 0);
          cy = y + (w.j || 0);
        } else if (w.r != null) {
          var c17 = centerFromR(x, y, nx, ny, w.r, cw);
          if (c17) { cx = c17.cx; cy = c17.cy; }
        }
        holdAngle = true;
        if (cx == null) emit(x, y, z, nx, ny, nz, false);
        else emitArc(emit, x, y, z, nx, ny, nz, cw, cx, cy, usePlane);
        holdAngle = false;
        if (Math.abs((angle + aOffset) - segA0) > 1e-6) emit(nx, ny, nz, nx, ny, nz, false);
      } else {
        emit(x, y, z, nx, ny, nz, mode === 0);
      }
      x = nx;
      y = ny;
      z = nz;
    }

    if (onProgress) onProgress(1, tEnd.n, lineNo);

    var n = tEnd.n;
    touch(px.a[0], py.a[0], pz.a[0]);
    if (!isFinite(minX)) {
      minX = 0; minY = 0; minZ = 0; maxX = 10; maxY = 10; maxZ = 1;
    }
    if (!(safeZ > 0)) safeZ = Math.max(maxZ, 0) + 5;

    var xOut = finish(px);
    var yOut = finish(py);
    var zOut = finish(pz);
    var tOut = finish(tEnd);

    for (var tpIndex = 0; tpIndex < meta.toolpaths.length; tpIndex++) {
      var item = meta.toolpaths[tpIndex];
      if (item.startSeg == null) continue;
      item.startTime = item.startSeg === 0 ? 0 : tOut[item.startSeg - 1];
    }

    return {
      n: n,
      lineCount: lineNo,
      x: xOut,
      y: yOut,
      z: zOut,
      a: finish(pa),
      rotary: rotaryMove,
      tEnd: tOut,
      feed: finish(feedA),
      rapid: finish(rapidA),
      tool: finish(toolA),
      spindle: finish(spindleA),
      spindleCmd: finish(spindleCmdA),
      coolant: finish(coolantA),
      absolute: finish(absoluteA),
      metric: finish(metricA),
      lineNo: finish(lineNoA),
      lineStart: finish(lineStartA),
      lineEnd: finish(lineEndA),
      lifts: finish(lifts),
      totalTime: n ? tOut[n - 1] : 0,
      cutTime: cutTime,
      rapidTime: rapidTime,
      safeZ: safeZ,
      bounds: { minX: minX, minY: minY, minZ: minZ, maxX: maxX, maxY: maxY, maxZ: maxZ },
      meta: meta
    };
  }

  var threads = [
    { id: "M2", name: "M2 × 0.4", major: 2, pitch: 0.4, pilot: 1.6 },
    { id: "M2.5", name: "M2.5 × 0.45", major: 2.5, pitch: 0.45, pilot: 2.05 },
    { id: "M3", name: "M3 × 0.5", major: 3, pitch: 0.5, pilot: 2.5 },
    { id: "M4", name: "M4 × 0.7", major: 4, pitch: 0.7, pilot: 3.3 },
    { id: "M5", name: "M5 × 0.8", major: 5, pitch: 0.8, pilot: 4.2 },
    { id: "M6", name: "M6 × 1.0", major: 6, pitch: 1, pilot: 5 },
    { id: "M8", name: "M8 × 1.25", major: 8, pitch: 1.25, pilot: 6.8 },
    { id: "#4-40", name: "#4-40", major: 2.845, pitch: 0.635, pilot: 2.261 },
    { id: "#6-32", name: "#6-32", major: 3.505, pitch: 0.794, pilot: 2.705 },
    { id: "#8-32", name: "#8-32", major: 4.166, pitch: 0.794, pilot: 3.454 },
    { id: "#10-24", name: "#10-24", major: 4.826, pitch: 1.058, pilot: 3.797 },
    { id: "#10-32", name: "#10-32", major: 4.826, pitch: 0.794, pilot: 4.039 },
    { id: "1/4-20", name: "1/4-20", major: 6.35, pitch: 1.27, pilot: 5.105 }
  ];

  function threadMillDiameter(pilot) {
    var target = pilot * 0.6;
    var choices = [1, 1.5, 2, 2.5, 3, 4, 5, 6];
    var best = 1;
    for (var i = 0; i < choices.length; i++) {
      var size = choices[i];
      if (!(size < pilot - 0.15)) continue;
      best = size;
      if (size >= target) return size;
    }
    return best;
  }

  function normalizeThread(raw, hole, label) {
    var major = Number(raw.major);
    var pitch = Number(raw.pitch);
    var depth = Number(raw.depth);
    var millDia = Number(raw.millDia);
    var feed = Number(raw.feed);
    var spindle = Math.round(Number(raw.spindle));
    var tool = Math.round(Number(raw.tool));
    if (!(major > 0)) throw new Error(label + " needs a thread diameter greater than 0.");
    if (!(pitch > 0)) throw new Error(label + " needs a thread pitch greater than 0.");
    if (!(depth > 0)) throw new Error(label + " needs a thread depth greater than 0.");
    if (!(millDia > 0)) throw new Error(label + " needs a thread mill diameter greater than 0.");
    if (!(feed > 0)) throw new Error(label + " needs a thread-mill feed greater than 0.");
    if (!(spindle > 0)) throw new Error(label + " needs a thread-mill spindle speed greater than 0.");
    if (!(tool >= 1)) throw new Error(label + " needs a thread-mill tool number of 1 or more.");
    if (millDia >= major - 0.05) throw new Error(label + " thread mill has to be smaller than the " + fmt(major) + " mm thread. The mill cuts the grooves from inside the hole.");
    if (millDia >= hole.diameter - 0.05) throw new Error(label + " is a " + fmt(hole.diameter) + " mm pilot and the thread mill is " + fmt(millDia) + " mm. The mill has to drop into the hole, so use a smaller thread mill than the drill.");
    if (tool === hole.tool) throw new Error(label + " uses T" + tool + " for the drill and the thread. Those are two bits. Give the thread mill its own tool number.");
    if (depth > hole.depth + 0.02) throw new Error(label + " thread is deeper than the drilled hole. Drill at least " + fmt(depth) + " mm, or shorten the thread so the mill does not hit the bottom.");
    return {
      name: raw.name || raw.preset || "thread",
      preset: raw.preset || "custom",
      major: major,
      pitch: pitch,
      pilot: Number(raw.pilot),
      depth: depth,
      millDia: millDia,
      feed: feed,
      spindle: spindle,
      tool: tool
    };
  }

  function cutPoint(lines, x, y, z, feed) {
    var line = "G1 X" + fmt(x) + " Y" + fmt(y) + " Z" + fmt(z);
    if (feed) line += " F" + fmt(feed);
    lines.push(line);
  }

  function appendThreads(lines, threaded, surface, approach, clearance) {
    var tool = null;
    var spindle = null;
    for (var i = 0; i < threaded.length; i++) {
      var hole = threaded[i];
      var thread = hole.thread;
      if (thread.tool !== tool || thread.spindle !== spindle) {
        if (tool != null) {
          lines.push("G0 Z" + fmt(clearance));
          lines.push("M9");
          lines.push("M05");
        }
        lines.push("T" + thread.tool + " M6");
        lines.push("M7");
        lines.push("S" + thread.spindle + " M3");
        tool = thread.tool;
        spindle = thread.spindle;
      }
      var radius = (thread.major - thread.millDia) / 2;
      var endZ = surface - thread.depth;
      var leadDrop = Math.min(thread.pitch * 0.5, thread.depth * 0.5);
      lines.push("; thread hole " + hole.number + " " + thread.name + " with a " + fmt(thread.millDia) + " mm thread mill in T" + thread.tool);
      lines.push("; pilot stays the drilled hole. This bit only cuts the grooves.");
      lines.push("G0 Z" + fmt(clearance));
      lines.push("G0 X" + fmt(hole.x) + " Y" + fmt(hole.y));
      lines.push("G0 Z" + fmt(approach));
      lines.push("G1 Z" + fmt(surface) + " F" + fmt(thread.feed));
      var leadSteps = 18;
      var s;
      for (s = 1; s <= leadSteps; s++) {
        var t = s / leadSteps;
        cutPoint(lines, hole.x + radius * t * Math.cos(Math.PI * t), hole.y + radius * t * Math.sin(Math.PI * t), surface - leadDrop * t);
      }
      var angle = Math.PI;
      var z = surface - leadDrop;
      var step = Math.PI / 36;
      var dz = -thread.pitch / 72;
      var guard = 0;
      while (z > endZ + 1e-4 && guard < 20000) {
        var zNext = z + dz;
        var aNext = angle + step;
        if (zNext < endZ) {
          var portion = (endZ - z) / dz;
          zNext = endZ;
          aNext = angle + step * portion;
        }
        cutPoint(lines, hole.x + radius * Math.cos(aNext), hole.y + radius * Math.sin(aNext), zNext);
        angle = aNext;
        z = zNext;
        guard++;
      }
      var outSteps = 18;
      for (s = 1; s <= outSteps; s++) {
        var u = s / outSteps;
        var rr = radius * (1 - u);
        var a = angle + Math.PI * u;
        cutPoint(lines, hole.x + rr * Math.cos(a), hole.y + rr * Math.sin(a), endZ);
      }
    }
  }

  function drillValue(hole, spec, key) {
    if (hole && hole[key] != null && hole[key] !== "") return hole[key];
    return spec[key];
  }

  function buildDrill(spec) {
    var holes = spec.holes || [];
    if (!holes.length) throw new Error("Place at least one hole.");
    var surface = Number(spec.surface);
    var clearance = Number(spec.clearance);
    if (!isFinite(surface)) surface = 0;
    if (!(clearance > surface + 0.5)) clearance = surface + 15;
    var approach = surface + 3;
    if (approach > clearance - 0.5) approach = surface + 1;

    var ready = [];
    for (var i = 0; i < holes.length; i++) {
      var src = holes[i];
      var label = "Hole " + (i + 1);
      var diameter = Number(drillValue(src, spec, "diameter"));
      var depth = Number(drillValue(src, spec, "depth"));
      var peck = Number(drillValue(src, spec, "peck"));
      var feed = Number(drillValue(src, spec, "feed"));
      var spindle = Math.round(Number(drillValue(src, spec, "spindle")));
      var tool = Math.round(Number(drillValue(src, spec, "tool")));
      if (!(diameter > 0)) throw new Error(label + " needs a diameter greater than 0.");
      if (!(depth > 0)) throw new Error(label + " needs a depth greater than 0.");
      if (!(peck > 0)) throw new Error(label + " needs a peck greater than 0.");
      if (!(feed > 0)) throw new Error(label + " needs a feed greater than 0.");
      if (!(spindle > 0)) throw new Error(label + " needs a spindle speed greater than 0.");
      if (!(tool >= 1)) throw new Error(label + " needs a tool number of 1 or more.");
      var row = {
        x: Number(src.x),
        y: Number(src.y),
        diameter: diameter,
        depth: depth,
        peck: peck,
        feed: feed,
        spindle: spindle,
        tool: tool,
        number: i + 1
      };
      if (src.thread) row.thread = normalizeThread(src.thread, row, label);
      ready.push(row);
    }

    var diaLabels = [];
    var threadNames = [];
    ready.forEach(function (h) {
      var label = fmt(h.diameter);
      if (diaLabels.indexOf(label) < 0) diaLabels.push(label);
      if (h.thread) {
        var token = h.thread.preset && h.thread.preset !== "custom" ? h.thread.preset : h.thread.name;
        token = String(token).replace(/#/g, "").replace(/\//g, "-").replace(/[^\w.\-]+/g, "");
        if (threadNames.indexOf(token) < 0) threadNames.push(token);
      }
    });
    var nl = "\r\n";
    var name;
    if (threadNames.length === 1 && ready.every(function (h) { return h.thread; })) {
      name = "Makera_" + ready.length + (ready.length === 1 ? "thread_" : "threads_") + threadNames[0] + ".NC";
    } else if (threadNames.length) {
      name = "Makera_" + ready.length + "holes_threaded.NC";
    } else if (diaLabels.length === 1) {
      name = "Makera_" + ready.length + (ready.length === 1 ? "hole_" : "holes_") + diaLabels[0] + "mm.NC";
    } else {
      name = "Makera_" + ready.length + "holes.NC";
    }
    var lines = [];
    lines.push(";@MKR|BEGIN");
    lines.push(";@MKR|MACHINE|id=Z1|name=Makera Z1");
    lines.push(";@MKR|UNIT|value=mm");
    if (spec.stock && spec.stock.length > 0 && spec.stock.width > 0 && spec.stock.height > 0) {
      lines.push(";@MKR|STOCK|id=cuboid|length=" + spec.stock.length + "|width=" + spec.stock.width + "|height=" + spec.stock.height);
    }
    if (spec.origin && isFinite(spec.origin.x)) {
      lines.push(";@MKR|ORIGIN|id=0|type_name=" + (spec.origin.type || "topFrontLeft") + "|x=" + spec.origin.x + "|y=" + spec.origin.y + "|z=" + spec.origin.z);
    }
    lines.push(";@MKR|END");
    lines.push("; DRILL");
    lines.push("; holes: " + ready.length);
    var summaryBits = [];
    var toolSizes = {};
    for (var h = 0; h < ready.length; h++) {
      var hole = ready[h];
      var bit = "hole " + (h + 1) + ": " + fmt(hole.diameter) + " mm, depth " + fmt(hole.depth) + ", peck " + fmt(hole.peck) + ", F" + fmt(hole.feed) + ", S" + hole.spindle + ", T" + hole.tool;
      lines.push("; " + bit);
      summaryBits.push("Hole " + (h + 1) + " is drilled " + fmt(hole.diameter) + " mm with T" + hole.tool);
      if (hole.thread) summaryBits.push("The " + hole.thread.name + " thread is a second cut with a " + fmt(hole.thread.millDia) + " mm thread mill in T" + hole.thread.tool);
      var seen = toolSizes[hole.tool] || [];
      if (seen.indexOf(fmt(hole.diameter)) < 0) seen.push(fmt(hole.diameter));
      toolSizes[hole.tool] = seen;
    }
    lines.push("; Each hole uses the drill saved with it. The path changes tools when the tool number changes.");
    if (spec.sourceName) lines.push("; laid_over: " + String(spec.sourceName).replace(/[\r\n]/g, " "));
    lines.push("");
    lines.push("G90 G21");

    var currentTool = null;
    var currentSpindle = null;
    for (var n = 0; n < ready.length; n++) {
      var item = ready[n];
      if (item.tool !== currentTool || item.spindle !== currentSpindle) {
        if (currentTool != null) {
          lines.push("G0 Z" + fmt(clearance));
          lines.push("M9");
          lines.push("M05");
        }
        lines.push("T" + item.tool + " M6");
        lines.push("M7");
        lines.push("S" + item.spindle + " M3");
        currentTool = item.tool;
        currentSpindle = item.spindle;
      }
      var bottom = surface - item.depth;
      lines.push("; hole " + (n + 1) + " " + fmt(item.diameter) + " mm");
      lines.push("G0 Z" + fmt(clearance));
      lines.push("G0 X" + fmt(item.x) + " Y" + fmt(item.y));
      lines.push("G0 Z" + fmt(approach));
      var z = surface;
      var prev = null;
      var guard = 0;
      while (z > bottom + 1e-6 && guard < 10000) {
        var next = z - item.peck;
        if (next < bottom) next = bottom;
        if (prev != null) {
          lines.push("G0 Z" + fmt(approach));
          var back = prev + Math.min(0.4, item.peck * 0.4);
          if (back < approach - 0.01) lines.push("G0 Z" + fmt(back));
        }
        lines.push("G1 Z" + fmt(next) + " F" + fmt(item.feed));
        prev = next;
        z = next;
        guard++;
      }
    }
    lines.push("G0 Z" + fmt(clearance));
    var threaded = ready.filter(function (item) { return item.thread; });
    if (threaded.length) {
      lines.push("M9");
      lines.push("M05");
      lines.push("; THREADS");
      lines.push("; The holes above were drilled with drill bits. Threading is a second cut.");
      lines.push("; Put a thread mill in the tool number below. It is smaller than the pilot and spirals inside the hole.");
      appendThreads(lines, threaded, surface, approach, clearance);
      lines.push("G0 Z" + fmt(clearance));
    }
    lines.push("M9");
    lines.push("M05");
    lines.push("G28");
    lines.push("M02");
    var shared = [];
    Object.keys(toolSizes).forEach(function (toolNo) {
      if (toolSizes[toolNo].length > 1) shared.push("T" + toolNo + " (" + toolSizes[toolNo].join(" mm, ") + " mm)");
    });
    var summary = summaryBits.join(". ") + ".";
    if (shared.length) summary += " These sizes share a tool number, so give each bit its own tool: " + shared.join("; ") + ".";
    return {
      name: name,
      content: lines.join(nl) + nl,
      diameter: ready[0].diameter,
      depth: ready[0].depth,
      summary: summary
    };
  }

  function shapeContains(shape, x, y) {
    if (!shape) return false;
    if (shape.type === "rect") {
      return x >= shape.minX && x <= shape.maxX && y >= shape.minY && y <= shape.maxY;
    }
    if (shape.type === "circle") {
      var dx = x - shape.cx;
      var dy = y - shape.cy;
      return dx * dx + dy * dy <= shape.r * shape.r + 1e-8;
    }
    var pts = shape.points || [];
    if (pts.length < 3) return false;
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var yi = pts[i].y;
      var yj = pts[j].y;
      if ((yi > y) === (yj > y)) continue;
      var xCross = (pts[j].x - pts[i].x) * (y - yi) / (yj - yi) + pts[i].x;
      if (x < xCross) inside = !inside;
    }
    if (inside) return true;
    for (var e = 0; e < pts.length; e++) {
      var a = pts[e];
      var b = pts[(e + 1) % pts.length];
      var ex = b.x - a.x;
      var ey = b.y - a.y;
      var len2 = ex * ex + ey * ey;
      if (len2 < 1e-12) continue;
      var t = ((x - a.x) * ex + (y - a.y) * ey) / len2;
      if (t < -0.001 || t > 1.001) continue;
      var px = a.x + ex * Math.min(1, Math.max(0, t));
      var py = a.y + ey * Math.min(1, Math.max(0, t));
      if ((px - x) * (px - x) + (py - y) * (py - y) <= 1e-6) return true;
    }
    return false;
  }

  function pointKept(shapes, x, y) {
    for (var i = 0; i < shapes.length; i++) {
      var inside = shapeContains(shapes[i], x, y);
      if (shapes[i].mode === "outside") {
        if (inside) return false;
      } else if (!inside) return false;
    }
    return true;
  }

  function pushBoundaryTs(shape, x0, y0, x1, y1, ts) {
    var dx = x1 - x0;
    var dy = y1 - y0;
    function add(t) {
      if (t > 1e-7 && t < 1 - 1e-7) ts.push(t);
    }
    if (shape.type === "rect") {
      if (Math.abs(dx) > 1e-12) {
        add((shape.minX - x0) / dx);
        add((shape.maxX - x0) / dx);
      }
      if (Math.abs(dy) > 1e-12) {
        add((shape.minY - y0) / dy);
        add((shape.maxY - y0) / dy);
      }
      return;
    }
    if (shape.type === "circle") {
      var fx = x0 - shape.cx;
      var fy = y0 - shape.cy;
      var a = dx * dx + dy * dy;
      var b = 2 * (fx * dx + fy * dy);
      var c = fx * fx + fy * fy - shape.r * shape.r;
      if (a < 1e-12) return;
      var disc = b * b - 4 * a * c;
      if (disc < 0) return;
      var root = Math.sqrt(disc);
      add((-b - root) / (2 * a));
      add((-b + root) / (2 * a));
      return;
    }
    var pts = shape.points || [];
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      var q = pts[(i + 1) % pts.length];
      var ex = q.x - p.x;
      var ey = q.y - p.y;
      var den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      var t = ((p.x - x0) * ey - (p.y - y0) * ex) / den;
      var u = ((p.x - x0) * dy - (p.y - y0) * dx) / den;
      if (u >= -1e-6 && u <= 1 + 1e-6) add(t);
    }
  }

  function acceptedIntervals(shapes, x0, y0, x1, y1) {
    var dx = x1 - x0;
    var dy = y1 - y0;
    var ts = [0, 1];
    for (var s = 0; s < shapes.length; s++) pushBoundaryTs(shapes[s], x0, y0, x1, y1, ts);
    ts.sort(function (a, b) { return a - b; });
    var uniq = [];
    for (var i = 0; i < ts.length; i++) {
      if (!uniq.length || ts[i] - uniq[uniq.length - 1] > 1e-6) uniq.push(ts[i]);
    }
    var kept = [];
    for (var k = 0; k < uniq.length - 1; k++) {
      var t0 = uniq[k];
      var t1 = uniq[k + 1];
      if (t1 - t0 < 1e-7) continue;
      var tm = (t0 + t1) / 2;
      if (pointKept(shapes, x0 + dx * tm, y0 + dy * tm)) kept.push([t0, t1]);
    }
    var merged = [];
    for (var m = 0; m < kept.length; m++) {
      if (!merged.length || kept[m][0] > merged[merged.length - 1][1] + 1e-5) merged.push([kept[m][0], kept[m][1]]);
      else merged[merged.length - 1][1] = kept[m][1];
    }
    return merged;
  }

  function toolpathIds(program) {
    var ids = new Uint16Array(program.n);
    var ranges = [];
    var list = program.meta && program.meta.toolpaths ? program.meta.toolpaths : [];
    for (var t = 0; t < list.length; t++) {
      if (list[t].startSeg != null) ranges.push({ seg: list[t].startSeg, number: list[t].number });
    }
    ranges.sort(function (a, b) { return a.seg - b.seg; });
    var current = 0;
    var r = 0;
    for (var i = 0; i < program.n; i++) {
      while (r < ranges.length && ranges[r].seg <= i) {
        current = ranges[r].number;
        r++;
      }
      ids[i] = current;
    }
    return ids;
  }

  function shapesForCut(shapes, pathId, toolNo) {
    var list = [];
    for (var s = 0; s < shapes.length; s++) {
      var shape = shapes[s];
      if (!shape.tools || !shape.tools.length) {
        list.push(shape);
        continue;
      }
      var id = shape.toolKind === "tool" ? toolNo : pathId;
      if (shape.tools.indexOf(id) >= 0) list.push(shape);
    }
    return list;
  }

  function clipChains(program, shapes) {
    var chains = [];
    var changed = false;
    var cur = null;
    var pathIds = toolpathIds(program);
    function closeChain() {
      if (cur && cur.pts.length > 1) chains.push(cur);
      cur = null;
    }
    for (var i = 0; i < program.n; i++) {
      if (program.rapid[i]) {
        closeChain();
        continue;
      }
      var x0 = program.x[i];
      var y0 = program.y[i];
      var z0 = program.z[i];
      var x1 = program.x[i + 1];
      var y1 = program.y[i + 1];
      var z1 = program.z[i + 1];
      var applicable = shapesForCut(shapes, pathIds[i], program.tool[i]);
      var intervals = applicable.length ? acceptedIntervals(applicable, x0, y0, x1, y1) : [[0, 1]];
      var full = intervals.length === 1 && intervals[0][0] <= 1e-5 && intervals[0][1] >= 1 - 1e-5;
      if (applicable.length && !full) changed = true;
      if (!intervals.length) {
        closeChain();
        continue;
      }
      var feed = program.feed[i];
      var tool = program.tool[i];
      for (var k = 0; k < intervals.length; k++) {
        var span = intervals[k];
        var ax = x0 + (x1 - x0) * span[0];
        var ay = y0 + (y1 - y0) * span[0];
        var az = z0 + (z1 - z0) * span[0];
        var bx = x0 + (x1 - x0) * span[1];
        var by = y0 + (y1 - y0) * span[1];
        var bz = z0 + (z1 - z0) * span[1];
        if (hypot3(bx - ax, by - ay, bz - az) < 1e-4) continue;
        var last = cur ? cur.pts[cur.pts.length - 1] : null;
        var pathId = pathIds[i];
        var join = last && cur.tool === tool && cur.pathId === pathId && Math.hypot(ax - last.x, ay - last.y) < 0.02 && Math.abs(az - last.z) < 0.02;
        if (!join) {
          closeChain();
          cur = {
            tool: tool,
            pathId: pathId,
            spindle: program.spindle[i],
            spindleCmd: program.spindleCmd[i],
            coolant: program.coolant[i],
            pts: [{ x: ax, y: ay, z: az, feed: feed }]
          };
        }
        cur.pts.push({ x: bx, y: by, z: bz, feed: feed });
      }
    }
    closeChain();
    return { chains: chains, changed: changed };
  }

  function shapeNote(shape) {
    var keep = shape.mode === "outside" ? "Outside" : "Inside";
    var where;
    if (shape.type === "rect") where = "a rectangle, X " + fmt(shape.minX) + " to " + fmt(shape.maxX) + ", Y " + fmt(shape.minY) + " to " + fmt(shape.maxY);
    else if (shape.type === "circle") where = "a circle at X " + fmt(shape.cx) + " Y " + fmt(shape.cy) + ", diameter " + fmt(shape.r * 2);
    else where = "a polygon with " + (shape.points ? shape.points.length : 0) + " corners";
    var who = shape.tools && shape.tools.length ? (shape.toolLabel || shape.tools.join(", ")) : "all tools";
    return keep + " " + where + ", on " + who;
  }

  function buildPatch(text, program, shapes, sourceName) {
    var active = [];
    (shapes || []).forEach(function (shape) {
      if (!shape) return;
      if (shape.type === "rect" && shape.maxX - shape.minX > 0.001 && shape.maxY - shape.minY > 0.001) active.push(shape);
      else if (shape.type === "circle" && shape.r > 0.001) active.push(shape);
      else if (shape.type === "poly" && shape.points && shape.points.length >= 3) active.push(shape);
    });
    if (!program || !program.n || !active.length) {
      return { changed: false, empty: false, content: text || "", summary: "Draw a shape, then Apply." };
    }
    var clipped = clipChains(program, active);
    if (!clipped.chains.length) {
      return {
        changed: true,
        empty: true,
        content: text || "",
        summary: "That would remove every cut, so the path was left as it is."
      };
    }
    var notes = active.map(shapeNote);
    if (!clipped.changed) {
      return {
        changed: false,
        empty: false,
        content: text || "",
        summary: notes.join(". ") + ". Every cut already stays, so nothing was added or removed."
      };
    }
    var nl = "\r\n";
    var header = extractHeader(text || "");
    if (!header) header = ";@MKR|BEGIN" + nl + ";@MKR|MACHINE|id=Z1|name=Makera Z1" + nl + ";@MKR|UNIT|value=mm" + nl + ";@MKR|END" + nl;
    if (!/\n$/.test(header)) header += nl;
    var clearance = program.safeZ;
    if (!(clearance > program.bounds.maxZ)) clearance = program.bounds.maxZ + 5;
    var metric = !(program.metric && program.metric[0] === 0);
    var safeName = String(sourceName || "program.nc").replace(/[\r\n]/g, " ");
    var lines = [];
    lines.push("; PATCH");
    lines.push("; source: " + safeName);
    notes.forEach(function (note) { lines.push("; " + note); });
    lines.push("; The bit lifts to clearance between the pieces that remain.");
    lines.push("; Confirm the work origin and the tool in the spindle before running.");
    lines.push("");
    lines.push("G90 " + (metric ? "G21" : "G20"));
    var currentTool = null;
    var currentSpindle = null;
    var currentCmd = null;
    var startedPath = {};
    clipped.chains.forEach(function (chain) {
      if (chain.pathId && !startedPath[chain.pathId]) {
        lines.push(";@MKR|TOOLPATH_START|toolpath_number=" + chain.pathId);
        startedPath[chain.pathId] = true;
      }
      var toolChanged = chain.tool !== currentTool;
      var spinChanged = chain.spindle !== currentSpindle || chain.spindleCmd !== currentCmd;
      if (toolChanged && currentTool != null) {
        lines.push("G0 Z" + fmt(clearance));
        lines.push("M9");
        lines.push("M05");
      }
      if (toolChanged && chain.tool > 0) lines.push("T" + chain.tool + " M6");
      if (toolChanged || spinChanged) {
        if (chain.coolant === 8) lines.push("M8");
        else if (chain.coolant === 9) lines.push("M9");
        else lines.push("M7");
        var speed = chain.spindle > 0 ? Math.round(chain.spindle) : 12000;
        var cmd = chain.spindleCmd === 4 ? 4 : 3;
        lines.push("S" + speed + " M" + cmd);
        currentTool = chain.tool;
        currentSpindle = chain.spindle;
        currentCmd = chain.spindleCmd;
      }
      var start = chain.pts[0];
      var cutFeed = start.feed > 1 ? start.feed : 300;
      entryBlock(clearance, start.x, start.y, start.z, cutFeed).replace(/\r\n$/, "").split(/\r\n/).forEach(function (line) {
        if (line) lines.push(line);
      });
      var feed = cutFeed;
      for (var p = 1; p < chain.pts.length; p++) {
        var pt = chain.pts[p];
        var nextFeed = pt.feed > 1 ? pt.feed : feed;
        var line = "G1 X" + fmt(pt.x) + " Y" + fmt(pt.y) + " Z" + fmt(pt.z);
        if (Math.abs(nextFeed - feed) > 0.1) {
          line += " F" + fmt(nextFeed);
          feed = nextFeed;
        }
        lines.push(line);
      }
    });
    lines.push("G0 Z" + fmt(clearance));
    lines.push("M9");
    lines.push("M05");
    lines.push("G28");
    lines.push("M02");
    var regions = clipped.chains.length;
    return {
      changed: true,
      empty: false,
      content: header + lines.join(nl) + nl,
      summary: notes.join(". ") + ". " + regions + (regions === 1 ? " cutting region remains." : " cutting regions remain.")
    };
  }

  function lastPassIndex(prog) {
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
    if (!found) return 0;
    var i = prog.n - 1;
    while (i >= start && prog.rapid[i]) i--;
    while (i >= start && !prog.rapid[i]) i--;
    return i + 1;
  }

  function finishToolRecord(prog, from) {
    var toolNum = prog.tool && from < prog.n ? prog.tool[from] : 0;
    var list = prog.meta && prog.meta.toolpaths ? prog.meta.toolpaths : [];
    var best = -1;
    for (var t = 0; t < list.length; t++) {
      if (list[t].startSeg == null || list[t].startSeg > from) continue;
      if (list[t].startSeg >= best) {
        best = list[t].startSeg;
        toolNum = list[t].tool;
      }
    }
    var tools = prog.meta && prog.meta.tools ? prog.meta.tools : [];
    for (var i = 0; i < tools.length; i++) {
      if (tools[i].number === toolNum) return tools[i];
    }
    return { number: toolNum, name: "", diameter: 0, type: "", tipDiameter: 0, halfAngle: 0 };
  }

  // Skin along the last rotary pass. One radius per angle throws away the far
  // side of a section whenever the near side lands on that same angle, which is
  // what was eating the carving between the thick and thin parts of this job.
  function buildFinishShape(program, axis) {
    if (!program || !program.n || !program.rotary || !program.a) return null;
    var from = lastPassIndex(program);
    if (!(from < program.n)) return null;
    var axisY = axis && isFinite(axis.y) ? axis.y : 0;
    var axisZ = axis && isFinite(axis.z) ? axis.z : 0;
    var limit = axis && axis.radius > 0 ? axis.radius + 1.5 : 1e6;
    var tool = finishToolRecord(program, from);
    var n = program.n;
    var px = program.x;
    var py = program.y;
    var pz = program.z;
    var pa = program.a;
    var rapid = program.rapid;
    var tipR = tool.tipDiameter > 0 ? tool.tipDiameter / 2 : 0;
    var inch = program.meta && /in/i.test(program.meta.unit || "");
    var hw = tipR > 0.04 ? tipR : 0.15;
    var minStep = 0.16;
    if (inch) {
      hw /= 25.4;
      minStep /= 25.4;
    }
    var breakStep = Math.max(2.5, hw * 12);
    var runs = [];
    var run = [];
    function wrapPoint(x, y, z, aDeg) {
      var dy = y - axisY;
      var dz = z - axisZ;
      var radius = Math.hypot(dy, dz);
      if (radius > limit) return null;
      var ang = Math.atan2(dy, dz) + aDeg * 0.017453292519943295;
      return [x, axisY + radius * Math.sin(ang), axisZ + radius * Math.cos(ang)];
    }
    function flush() {
      if (run.length > 1) runs.push(run);
      run = [];
    }
    function keep(p) {
      if (!p) {
        flush();
        return;
      }
      var m = run.length;
      if (!m) {
        run.push(p);
        return;
      }
      var q = run[m - 1];
      var dist = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      if (dist < minStep) return;
      if (dist > breakStep) {
        flush();
        run.push(p);
        return;
      }
      run.push(p);
    }
    var i;
    var s;
    for (i = from; i < n; i++) {
      if (rapid[i]) {
        flush();
        continue;
      }
      var dx = px[i + 1] - px[i];
      var dy = py[i + 1] - py[i];
      var dz = pz[i + 1] - pz[i];
      var dA = pa[i + 1] - pa[i];
      var chord = Math.hypot(dx, dy, dz);
      var steps = Math.max(1, Math.ceil(Math.abs(dA) / 3));
      if (chord > 0) steps = Math.max(steps, Math.ceil(chord / minStep));
      if (steps > 160) steps = 160;
      for (s = 0; s <= steps; s++) {
        var u = s / steps;
        keep(wrapPoint(px[i] + dx * u, py[i] + dy * u, pz[i] + dz * u, pa[i] + dA * u));
      }
    }
    flush();
    var quads = 0;
    for (i = 0; i < runs.length; i++) quads += runs[i].length - 1;
    if (quads < 2) return null;
    var data = new Float32Array(quads * 6 * 6);
    var o = 0;
    var nrmY = 0;
    var nrmZ = 1;
    function put(p, side, sign, n) {
      data[o] = p[0] + side[0] * hw * sign;
      data[o + 1] = p[1] + side[1] * hw * sign;
      data[o + 2] = p[2] + side[2] * hw * sign;
      data[o + 3] = n[0];
      data[o + 4] = n[1];
      data[o + 5] = n[2];
      o += 6;
    }
    for (i = 0; i < runs.length; i++) {
      var pts = runs[i];
      var prevS = null;
      for (var k = 0; k < pts.length - 1; k++) {
        var p = pts[k];
        var q = pts[k + 1];
        var ry = p[1] - axisY;
        var rz = p[2] - axisZ;
        var rl = Math.hypot(ry, rz);
        if (rl > 1e-4) {
          nrmY = ry / rl;
          nrmZ = rz / rl;
        } else {
          nrmY = 0;
          nrmZ = 1;
        }
        var tx = q[0] - p[0];
        var ty = q[1] - p[1];
        var tz = q[2] - p[2];
        var sx = ty * nrmZ - tz * nrmY;
        var sy = 0 - tx * nrmZ;
        var sz = tx * nrmY;
        var sl = Math.hypot(sx, sy, sz);
        if (sl < 1e-6) {
          sx = 0;
          sy = -nrmZ;
          sz = nrmY;
          sl = Math.hypot(sy, sz) || 1;
        }
        sx /= sl;
        sy /= sl;
        sz /= sl;
        if (prevS && sx * prevS[0] + sy * prevS[1] + sz * prevS[2] < 0) {
          sx = -sx;
          sy = -sy;
          sz = -sz;
        }
        var side = [sx, sy, sz];
        prevS = side;
        var nx = ty * sz - tz * sy;
        var ny = tz * sx - tx * sz;
        var nz = tx * sy - ty * sx;
        var nl = Math.hypot(nx, ny, nz);
        if (!(nl > 1e-8)) {
          nx = 0;
          ny = nrmY;
          nz = nrmZ;
        } else {
          nx /= nl;
          ny /= nl;
          nz /= nl;
          if (ny * nrmY + nz * nrmZ < 0) {
            nx = -nx;
            ny = -ny;
            nz = -nz;
          }
        }
        var nrm = [nx, ny, nz];
        put(p, side, 1, nrm);
        put(p, side, -1, nrm);
        put(q, side, -1, nrm);
        put(p, side, 1, nrm);
        put(q, side, -1, nrm);
        put(q, side, 1, nrm);
      }
    }
    return {
      data: data,
      count: quads * 6,
      from: from,
      tool: {
        number: tool.number || 0,
        name: tool.name || "",
        type: tool.type || "",
        diameter: tool.diameter || 0,
        tipDiameter: tool.tipDiameter || 0,
        halfAngle: tool.halfAngle || 0
      }
    };
  }

  var api = {
    parseProgram: parseProgram,
    buildRedo: buildRedo,
    buildFinishShape: buildFinishShape,
    buildDrill: buildDrill,
    buildPatch: buildPatch,
    shapeContains: shapeContains,
    threads: threads,
    threadMillDiameter: threadMillDiameter,
    sampleAt: sampleAt,
    adjacentLift: adjacentLift,
    formatTime: formatTime,
    redoName: redoName,
    fmt: fmt
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Makera = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
