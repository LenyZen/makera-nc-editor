(function (root) {
  const NS = root.STL2SVG || (root.STL2SVG = {});
  const WELD = 0.001;
  const PROBE = 0.005;

  function clampWidth(width) {
    const value = Number(width);
    if (!Number.isFinite(value)) return 1.5;
    return Math.min(30, Math.max(0.2, value));
  }

  function pointInPoly(p, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      const hit = ((a.y > p.y) !== (b.y > p.y)) &&
        (p.x < (b.x - a.x) * (p.y - a.y) / ((b.y - a.y) || 1e-12) + a.x);
      if (hit) inside = !inside;
    }
    return inside;
  }

  function evenOdd(p, contours) {
    let count = 0;
    for (const contour of contours) if (pointInPoly(p, contour.pts)) count++;
    return count % 2 === 1;
  }

  function weld(segments) {
    const pts = [];
    const grid = new Map();
    function bucket(ix, iy) {
      const key = ix + "," + iy;
      let list = grid.get(key);
      if (!list) grid.set(key, list = []);
      return list;
    }
    function add(p) {
      const ix = Math.round(p.x / WELD);
      const iy = Math.round(p.y / WELD);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const list = grid.get((ix + dx) + "," + (iy + dy));
          if (!list) continue;
          for (const id of list) {
            const q = pts[id];
            if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 <= WELD * WELD) return id;
          }
        }
      }
      const id = pts.length;
      pts.push({ x: p.x, y: p.y });
      bucket(ix, iy).push(id);
      return id;
    }
    const edges = [];
    const seen = new Set();
    for (const seg of segments) {
      const i = add(seg.a);
      const j = add(seg.b);
      if (i === j) continue;
      const key = i < j ? i + "," + j : j + "," + i;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([i, j]);
    }
    return { pts, edges };
  }

  function addCuts(s, t, cutsS, cutsT) {
    const ax = s.a.x, ay = s.a.y, bx = s.b.x, by = s.b.y;
    const cx = t.a.x, cy = t.a.y, dx = t.b.x, dy = t.b.y;
    const rx = bx - ax, ry = by - ay;
    const sx = dx - cx, sy = dy - cy;
    const den = rx * sy - ry * sx;
    const qpx = cx - ax, qpy = cy - ay;
    const scale = Math.hypot(rx, ry) * Math.hypot(sx, sy);
    if (Math.abs(den) <= 1e-12 * (scale + 1)) {
      const len = Math.hypot(rx, ry);
      if (len < 1e-12) return;
      const tol = 1e-7 * len;
      if (Math.abs(qpx * ry - qpy * rx) > tol) return;
      if (Math.abs((dx - ax) * ry - (dy - ay) * rx) > tol) return;
      const len2 = rx * rx + ry * ry;
      const tc = (qpx * rx + qpy * ry) / len2;
      const td = ((dx - ax) * rx + (dy - ay) * ry) / len2;
      if (tc > 1e-9 && tc < 1 - 1e-9) cutsS.push(tc);
      if (td > 1e-9 && td < 1 - 1e-9) cutsS.push(td);
      const slen2 = sx * sx + sy * sy;
      if (slen2 < 1e-18) return;
      const ua = ((ax - cx) * sx + (ay - cy) * sy) / slen2;
      const ub = ((bx - cx) * sx + (by - cy) * sy) / slen2;
      if (ua > 1e-9 && ua < 1 - 1e-9) cutsT.push(ua);
      if (ub > 1e-9 && ub < 1 - 1e-9) cutsT.push(ub);
      return;
    }
    const tt = (qpx * sy - qpy * sx) / den;
    const u = (qpx * ry - qpy * rx) / den;
    if (tt < -1e-9 || tt > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return;
    if (tt > 1e-9 && tt < 1 - 1e-9) cutsS.push(tt);
    if (u > 1e-9 && u < 1 - 1e-9) cutsT.push(u);
  }

  function splitSegments(segments) {
    const cuts = segments.map(() => [0, 1]);
    const cell = 4;
    const grid = new Map();
    function stamp(index) {
      const seg = segments[index];
      const x0 = Math.floor(Math.min(seg.a.x, seg.b.x) / cell);
      const x1 = Math.floor(Math.max(seg.a.x, seg.b.x) / cell);
      const y0 = Math.floor(Math.min(seg.a.y, seg.b.y) / cell);
      const y1 = Math.floor(Math.max(seg.a.y, seg.b.y) / cell);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const key = x + "," + y;
          let list = grid.get(key);
          if (!list) grid.set(key, list = []);
          list.push(index);
        }
      }
    }
    for (let i = 0; i < segments.length; i++) stamp(i);
    const seen = new Set();
    for (const list of grid.values()) {
      for (let a = 0; a < list.length; a++) {
        for (let b = a + 1; b < list.length; b++) {
          const i = list[a], j = list[b];
          if (i === j) continue;
          const key = i < j ? i + "," + j : j + "," + i;
          if (seen.has(key)) continue;
          seen.add(key);
          addCuts(segments[i], segments[j], cuts[i], cuts[j]);
        }
      }
    }
    const pieces = [];
    for (let i = 0; i < segments.length; i++) {
      const times = cuts[i].sort((p, q) => p - q);
      const unique = [];
      for (const t of times) {
        if (!unique.length || t - unique[unique.length - 1] > 1e-8) unique.push(Math.min(1, Math.max(0, t)));
      }
      const seg = segments[i];
      for (let k = 0; k < unique.length - 1; k++) {
        const t0 = unique[k], t1 = unique[k + 1];
        if (t1 - t0 < 1e-8) continue;
        pieces.push({
          a: { x: seg.a.x + (seg.b.x - seg.a.x) * t0, y: seg.a.y + (seg.b.y - seg.a.y) * t0 },
          b: { x: seg.a.x + (seg.b.x - seg.a.x) * t1, y: seg.a.y + (seg.b.y - seg.a.y) * t1 }
        });
      }
    }
    return pieces;
  }

  function boundaryOf(segments, keepOf) {
    const pieces = splitSegments(segments);
    const welded = weld(pieces);
    const pts = welded.pts;
    const edges = welded.edges;
    if (!edges.length) return [];
    const adj = pts.map(() => []);
    for (let ei = 0; ei < edges.length; ei++) {
      const a = edges[ei][0], b = edges[ei][1];
      adj[a].push({
        from: a,
        to: b,
        ang: Math.atan2(pts[b].y - pts[a].y, pts[b].x - pts[a].x),
        ei,
        half: ei * 2
      });
      adj[b].push({
        from: b,
        to: a,
        ang: Math.atan2(pts[a].y - pts[b].y, pts[a].x - pts[b].x),
        ei,
        half: ei * 2 + 1
      });
    }
    for (const list of adj) list.sort((p, q) => p.ang - q.ang || p.ei - q.ei);

    function nextOf(half) {
      const list = adj[half.to];
      let index = -1;
      for (let i = 0; i < list.length; i++) {
        if (list[i].ei === half.ei && list[i].to === half.from) {
          index = i;
          break;
        }
      }
      if (index < 0 || list.length < 2) return null;
      return list[(index - 1 + list.length) % list.length];
    }

    function leftPoint(ring) {
      let best = 0;
      let bestLen = -1;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const dist = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
        if (dist > bestLen) {
          bestLen = dist;
          best = i;
        }
      }
      const a = ring[best];
      const b = ring[(best + 1) % ring.length];
      const len = Math.sqrt(bestLen) || 1;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      return {
        x: mx + -(b.y - a.y) / len * PROBE,
        y: my + (b.x - a.x) / len * PROBE
      };
    }

    const used = new Array(edges.length * 2).fill(false);
    const faceOf = new Array(edges.length * 2).fill(-1);
    const faces = [];
    for (const list of adj) {
      for (const start of list) {
        if (used[start.half]) continue;
        const ring = [];
        const halves = [];
        let half = start;
        let guard = 0;
        let area = 0;
        const seen = new Set();
        while (half && guard++ < edges.length * 4) {
          if (seen.has(half.half)) break;
          seen.add(half.half);
          halves.push(half.half);
          ring.push(pts[half.from]);
          const a = pts[half.from], b = pts[half.to];
          area += a.x * b.y - b.x * a.y;
          const next = nextOf(half);
          if (!next || next.half === start.half) {
            half = next;
            break;
          }
          half = next;
        }
        for (const id of halves) used[id] = true;
        const closed = half && half.half === start.half && ring.length >= 3 && Math.abs(area) > 1e-8;
        if (!closed) continue;
        const faceIndex = faces.length;
        faces.push({ keep: keepOf(leftPoint(ring)) });
        for (const id of halves) faceOf[id] = faceIndex;
      }
    }

    const boundary = [];
    for (let ei = 0; ei < edges.length; ei++) {
      const left = faceOf[ei * 2];
      const right = faceOf[ei * 2 + 1];
      const keepLeft = left >= 0 ? faces[left].keep : null;
      const keepRight = right >= 0 ? faces[right].keep : null;
      if (keepLeft === null && keepRight === null) continue;
      if (keepLeft === keepRight) continue;
      boundary.push({ a: pts[edges[ei][0]], b: pts[edges[ei][1]] });
    }
    return boundary;
  }

  function contourSegments(contours) {
    const segments = [];
    for (const contour of contours) {
      const pts = contour.pts;
      for (let i = 0; i < pts.length; i++) {
        segments.push({ a: pts[i], b: pts[(i + 1) % pts.length] });
      }
    }
    return segments;
  }

  function bridgeSegments(bridges) {
    const segments = [];
    for (const poly of bridges) {
      for (let i = 0; i < poly.length; i++) {
        segments.push({ a: poly[i], b: poly[(i + 1) % poly.length] });
      }
    }
    return segments;
  }

  function isKeep(point, pattern, bridges) {
    if (evenOdd(point, pattern.closed)) return true;
    for (const poly of bridges) if (pointInPoly(point, poly)) return true;
    return false;
  }

  function closestSegSeg(a, b, c, d) {
    const ux = b.x - a.x, uy = b.y - a.y;
    const vx = d.x - c.x, vy = d.y - c.y;
    const wx = a.x - c.x, wy = a.y - c.y;
    const aa = ux * ux + uy * uy;
    const bb = ux * vx + uy * vy;
    const cc = vx * vx + vy * vy;
    const dd = ux * wx + uy * wy;
    const ee = vx * wx + vy * wy;
    const disc = aa * cc - bb * bb;
    let sN, sD = disc, tN, tD = disc;
    if (disc < 1e-12) {
      sN = 0;
      sD = 1;
      tN = ee;
      tD = cc;
    } else {
      sN = bb * ee - cc * dd;
      tN = aa * ee - bb * dd;
      if (sN < 0) {
        sN = 0;
        tN = ee;
        tD = cc;
      } else if (sN > sD) {
        sN = sD;
        tN = ee + bb;
        tD = cc;
      }
    }
    if (tN < 0) {
      tN = 0;
      if (-dd < 0) sN = 0;
      else if (-dd > aa) sN = sD;
      else { sN = -dd; sD = aa; }
    } else if (tN > tD) {
      tN = tD;
      if (-dd + bb < 0) sN = 0;
      else if (-dd + bb > aa) sN = sD;
      else { sN = -dd + bb; sD = aa; }
    }
    const sc = Math.abs(sN) < 1e-12 || Math.abs(sD) < 1e-12 ? 0 : sN / sD;
    const tc = Math.abs(tN) < 1e-12 || Math.abs(tD) < 1e-12 ? 0 : tN / tD;
    const px = a.x + sc * ux, py = a.y + sc * uy;
    const qx = c.x + tc * vx, qy = c.y + tc * vy;
    return { p: { x: px, y: py }, q: { x: qx, y: qy }, dist: Math.hypot(px - qx, py - qy) };
  }

  function closestPolys(pa, pb) {
    let best = Infinity;
    let hitA = pa[0];
    let hitB = pb[0];
    for (let i = 0; i < pa.length; i++) {
      const a0 = pa[i], a1 = pa[(i + 1) % pa.length];
      for (let j = 0; j < pb.length; j++) {
        const b0 = pb[j], b1 = pb[(j + 1) % pb.length];
        const hit = closestSegSeg(a0, a1, b0, b1);
        if (hit.dist < best) {
          best = hit.dist;
          hitA = hit.p;
          hitB = hit.q;
        }
      }
    }
    return { a: hitA, b: hitB, dist: best };
  }

  function rectBetween(a, b, width) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const px = -dy / len * (width / 2);
    const py = dx / len * (width / 2);
    return [
      { x: a.x + px, y: a.y + py },
      { x: b.x + px, y: b.y + py },
      { x: b.x - px, y: b.y - py },
      { x: a.x - px, y: a.y - py }
    ];
  }

  function bridgeFor(loose, target, width) {
    const hit = closestPolys(loose.pts, target.pts);
    let ax = hit.a.x, ay = hit.a.y, bx = hit.b.x, by = hit.b.y;
    let dx = bx - ax, dy = by - ay;
    let len = Math.hypot(dx, dy);
    if (len < 0.05) {
      dx = ax - loose.inside.x;
      dy = ay - loose.inside.y;
      len = Math.hypot(dx, dy) || 1;
      bx = ax + dx / len;
      by = ay + dy / len;
    }
    const ux = dx / len, uy = dy / len;
    const overlap = Math.max(0.35, width * 0.35);
    const start = { x: ax - ux * overlap, y: ay - uy * overlap };
    const end = { x: bx + ux * overlap, y: by + uy * overlap };
    return { poly: rectBetween(start, end, width), distance: hit.dist };
  }

  function segmentsCross(a, b, c, d) {
    function side(p, q, r) {
      return (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    }
    function onSeg(p, s, e) {
      const dx = e.x - s.x, dy = e.y - s.y;
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-16) return (p.x - s.x) ** 2 + (p.y - s.y) ** 2 < 1e-8;
      const t = ((p.x - s.x) * dx + (p.y - s.y) * dy) / len2;
      if (t < -1e-6 || t > 1 + 1e-6) return false;
      const x = s.x + t * dx, y = s.y + t * dy;
      return (x - p.x) ** 2 + (y - p.y) ** 2 < 1e-8;
    }
    if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) return true;
    return onSeg(c, a, b) || onSeg(d, a, b) || onSeg(a, c, d) || onSeg(b, c, d);
  }

  function polysTouch(a, b) {
    for (const p of a) if (pointInPoly(p, b)) return true;
    for (const p of b) if (pointInPoly(p, a)) return true;
    for (let i = 0; i < a.length; i++) {
      const a0 = a[i], a1 = a[(i + 1) % a.length];
      for (let j = 0; j < b.length; j++) {
        if (segmentsCross(a0, a1, b[j], b[(j + 1) % b.length])) return true;
      }
    }
    return false;
  }

  function samplePoints(poly) {
    const pts = poly.slice();
    let x = 0, y = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      pts.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      x += a.x;
      y += a.y;
    }
    pts.push({ x: x / poly.length, y: y / poly.length });
    return pts;
  }

  function nearest(pattern, width) {
    const loose = (pattern.closed || []).filter((contour) => contour.role === "loose");
    if (!loose.length) return { ok: false, message: "There are no loose pieces in this cut." };
    const span = clampWidth(width);
    const bridges = [];
    const gaps = [];
    for (const piece of loose) {
      const parent = piece.parent >= 0 ? pattern.closed[piece.parent] : null;
      if (!parent) continue;
      const bridge = bridgeFor(piece, parent, span);
      bridges.push(bridge.poly);
      gaps.push({ distance: bridge.distance });
    }
    if (!bridges.length) {
      return { ok: false, message: "The loose pieces have no surrounding material to join to." };
    }
    return { ok: true, bridges, gaps, width: span, count: bridges.length };
  }

  function fromShape(pattern, poly) {
    if (!poly || poly.length < 3) return { ok: false, message: "Draw a larger box or circle." };
    const loose = (pattern.closed || []).filter((contour) => contour.role === "loose");
    if (!loose.length) return { ok: false, message: "There are no loose pieces in this cut." };
    const hit = loose.filter((contour) => polysTouch(poly, contour.pts));
    if (!hit.length) {
      return { ok: false, message: "That shape misses the loose pieces. Draw it across a loose piece and the material around it." };
    }
    const samples = samplePoints(poly);
    let reaches = false;
    for (const point of samples) {
      if (loose.some((contour) => pointInPoly(point, contour.pts))) continue;
      if (evenOdd(point, pattern.closed)) {
        reaches = true;
        break;
      }
    }
    if (!reaches) {
      return { ok: false, message: "That shape stays on the loose piece. Draw it across the gap and onto the material that stays." };
    }
    return { ok: true, bridges: [poly], gaps: [], width: null, count: hit.length };
  }

  function apply(pattern, bridges) {
    if (!pattern || !bridges || !bridges.length) return null;
    const before = pattern.closed.filter((contour) => contour.role === "loose").length;
    const segments = contourSegments(pattern.closed).concat(bridgeSegments(bridges));
    const boundary = boundaryOf(segments, (point) => isKeep(point, pattern, bridges));
    if (!boundary.length) return null;
    const next = NS.contours.analyze(boundary, pattern.tolerance || 0);
    if (next.open.length) return null;
    const after = next.closed.filter((contour) => contour.role === "loose").length;
    if (after >= before) return null;
    return NS.contours.finish(next, {
      open: pattern.open || [],
      repaired: next.gaps.length ? 0 : (pattern.repaired || 0),
      attached: (pattern.attached || 0) + (before - after),
      nudged: !!pattern.nudged
    });
  }

  NS.bridge = { nearest, fromShape, apply, clampWidth };
})(typeof window !== "undefined" ? window : globalThis);
