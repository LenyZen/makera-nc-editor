(function (root) {
  const NS = root.STL2SVG || (root.STL2SVG = {});
  const WELD = 0.001;

  function weld(segments) {
    const pts = [];
    const grid = new Map();
    const cell = WELD;
    function bucket(ix, iy) {
      const k = ix + "," + iy;
      let list = grid.get(k);
      if (!list) grid.set(k, list = []);
      return list;
    }
    function add(p) {
      const ix = Math.round(p.x / cell);
      const iy = Math.round(p.y / cell);
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
    const counts = new Map();
    for (const seg of segments) {
      const i = add(seg.a);
      const j = add(seg.b);
      if (i === j) continue;
      const key = i < j ? i + "," + j : j + "," + i;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const edges = [];
    let duplicates = 0;
    for (const [key, count] of counts) {
      if (count > 1) duplicates += count - 1;
      const parts = key.split(",");
      edges.push([Number(parts[0]), Number(parts[1])]);
    }
    return { pts, edges, duplicates };
  }

  function overlapLength(pts, e0, e1, tol) {
    if (e0[0] === e1[0] || e0[0] === e1[1] || e0[1] === e1[0] || e0[1] === e1[1]) return 0;
    const a = pts[e0[0]], b = pts[e0[1]], c = pts[e1[0]], d = pts[e1[1]];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return 0;
    const ux = dx / len, uy = dy / len;
    const dc = Math.abs((c.x - a.x) * uy - (c.y - a.y) * ux);
    const dd = Math.abs((d.x - a.x) * uy - (d.y - a.y) * ux);
    if (dc > tol || dd > tol) return 0;
    const elx = d.x - c.x, ely = d.y - c.y;
    if (Math.abs(elx * uy - ely * ux) > tol) return 0;
    const tc = (c.x - a.x) * ux + (c.y - a.y) * uy;
    const td = (d.x - a.x) * ux + (d.y - a.y) * uy;
    const lo = Math.max(0, Math.min(tc, td));
    const hi = Math.min(len, Math.max(tc, td));
    return Math.max(0, hi - lo);
  }

  function countOverlaps(pts, edges) {
    if (edges.length > 80000) return { count: 0, skipped: true };
    const tol = 0.02;
    const cell = 5;
    const grid = new Map();
    function stamp(ei) {
      const a = pts[edges[ei][0]], b = pts[edges[ei][1]];
      const x0 = Math.floor(Math.min(a.x, b.x) / cell);
      const x1 = Math.floor(Math.max(a.x, b.x) / cell);
      const y0 = Math.floor(Math.min(a.y, b.y) / cell);
      const y1 = Math.floor(Math.max(a.y, b.y) / cell);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const k = x + "," + y;
          let list = grid.get(k);
          if (!list) grid.set(k, list = []);
          list.push(ei);
        }
      }
    }
    edges.forEach((_, ei) => stamp(ei));
    const seen = new Set();
    let count = 0;
    for (const list of grid.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j];
          const key = a < b ? a + "," + b : b + "," + a;
          if (seen.has(key)) continue;
          seen.add(key);
          if (overlapLength(pts, edges[a], edges[b], tol) > tol) count++;
        }
      }
    }
    return { count, skipped: false };
  }

  function walk(pts, edges) {
    const adj = pts.map(() => []);
    edges.forEach((edge, ei) => {
      adj[edge[0]].push({ to: edge[1], ei });
      adj[edge[1]].push({ to: edge[0], ei });
    });
    const used = new Array(edges.length).fill(false);

    function step(prev, curr) {
      const options = adj[curr].filter((o) => !used[o.ei]);
      if (!options.length) return null;
      const ix = pts[curr].x - pts[prev].x;
      const iy = pts[curr].y - pts[prev].y;
      let best = options[0];
      let bestAng = -Infinity;
      for (const option of options) {
        const ox = pts[option.to].x - pts[curr].x;
        const oy = pts[option.to].y - pts[curr].y;
        const ang = Math.atan2(ix * oy - iy * ox, ix * ox + iy * oy);
        if (ang > bestAng) {
          bestAng = ang;
          best = option;
        }
      }
      used[best.ei] = true;
      return best.to;
    }

    const contours = [];
    for (let ei = 0; ei < edges.length; ei++) {
      if (used[ei]) continue;
      used[ei] = true;
      const start = edges[ei][0];
      let prev = start;
      let curr = edges[ei][1];
      const forward = [start, curr];
      let guard = 0;
      let closed = false;
      while (guard++ < edges.length + 2) {
        if (curr === start) {
          closed = true;
          forward.pop();
          break;
        }
        const next = step(prev, curr);
        if (next === null) break;
        prev = curr;
        curr = next;
        forward.push(curr);
        if (curr === start) {
          closed = true;
          forward.pop();
          break;
        }
      }
      if (!closed) {
        prev = forward[1];
        curr = forward[0];
        guard = 0;
        while (guard++ < edges.length + 2) {
          const next = step(prev, curr);
          if (next === null) break;
          prev = curr;
          curr = next;
          forward.unshift(curr);
          if (curr === forward[forward.length - 1]) break;
        }
      }
      contours.push({
        indices: forward,
        closed,
        pts: forward.map((id) => pts[id])
      });
    }
    return contours;
  }

  function polygonArea(pts) {
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      area += a.x * b.y - b.x * a.y;
    }
    return area / 2;
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

  function interiorPoint(pts) {
    let best = 0;
    let bestLen = -1;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const d = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
      if (d > bestLen) {
        bestLen = d;
        best = i;
      }
    }
    const a = pts[best];
    const b = pts[(best + 1) % pts.length];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const len = Math.sqrt(bestLen) || 1;
    const lx = -(b.y - a.y) / len;
    const ly = (b.x - a.x) / len;
    const eps = Math.min(0.05, len * 0.25);
    let p = { x: mx + lx * eps, y: my + ly * eps };
    if (!pointInPoly(p, pts)) p = { x: mx - lx * eps, y: my - ly * eps };
    return p;
  }

  function classify(contours) {
    const closed = contours.filter((c) => c.closed && c.pts.length >= 3).map((c) => {
      const area = polygonArea(c.pts);
      return {
        pts: c.pts,
        area,
        abs: Math.abs(area),
        inside: interiorPoint(c.pts),
        depth: 0,
        parent: -1,
        role: "outline"
      };
    });
    for (let i = 0; i < closed.length; i++) {
      let parent = -1;
      let parentAbs = Infinity;
      for (let j = 0; j < closed.length; j++) {
        if (i === j || closed[j].abs <= closed[i].abs) continue;
        if (closed[j].abs < parentAbs && pointInPoly(closed[i].inside, closed[j].pts)) {
          parent = j;
          parentAbs = closed[j].abs;
        }
      }
      closed[i].parent = parent;
    }
    for (let i = 0; i < closed.length; i++) {
      let depth = 0;
      let p = closed[i].parent;
      const guard = new Set();
      while (p >= 0 && !guard.has(p)) {
        guard.add(p);
        depth++;
        p = closed[p].parent;
      }
      closed[i].depth = depth;
      if (depth === 0) closed[i].role = "outline";
      else if (depth % 2 === 1) closed[i].role = "hole";
      else closed[i].role = "loose";
    }
    return closed;
  }

  function gapsOf(pts, edges, tolerance) {
    const degree = new Array(pts.length).fill(0);
    for (const edge of edges) {
      degree[edge[0]]++;
      degree[edge[1]]++;
    }
    const ends = [];
    for (let i = 0; i < degree.length; i++) if (degree[i] === 1) ends.push(i);
    const pairs = [];
    const used = new Set();
    const candidates = [];
    for (let i = 0; i < ends.length; i++) {
      for (let j = i + 1; j < ends.length; j++) {
        const a = pts[ends[i]], b = pts[ends[j]];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (distance <= tolerance && distance > WELD) candidates.push({ i: ends[i], j: ends[j], distance });
      }
    }
    candidates.sort((a, b) => a.distance - b.distance);
    for (const pair of candidates) {
      if (used.has(pair.i) || used.has(pair.j)) continue;
      used.add(pair.i);
      used.add(pair.j);
      pairs.push(pair);
    }
    return pairs;
  }

  function boundsOf(contours) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const all = contours.closed.concat(contours.open);
    for (const contour of all) {
      for (const p of contour.pts) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }
    if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  }

  function analyze(segments, tolerance) {
    const welded = weld(segments);
    const overlaps = countOverlaps(welded.pts, welded.edges);
    const raw = walk(welded.pts, welded.edges);
    const closed = classify(raw);
    const open = raw.filter((c) => !c.closed && c.pts.length >= 2);
    const gapTol = Math.max(0, Number(tolerance) || 0);
    const gaps = gapsOf(welded.pts, welded.edges, gapTol);
    const pattern = {
      pts: welded.pts,
      edges: welded.edges,
      closed,
      open,
      duplicates: welded.duplicates,
      overlaps: overlaps.count,
      overlapSkipped: overlaps.skipped,
      gaps,
      tolerance: gapTol,
      repaired: 0
    };
    pattern.bounds = boundsOf(pattern);
    return pattern;
  }

  function segmentsOf(pattern) {
    if (pattern.edges && pattern.edges.length && pattern.pts && pattern.pts.length) {
      return pattern.edges.map((edge) => ({ a: pattern.pts[edge[0]], b: pattern.pts[edge[1]] }));
    }
    const segments = [];
    const all = (pattern.closed || []).concat(pattern.open || []);
    for (const contour of all) {
      const count = contour.pts.length;
      const last = contour.closed ? count : count - 1;
      for (let i = 0; i < last; i++) {
        segments.push({ a: contour.pts[i], b: contour.pts[(i + 1) % count] });
      }
    }
    return segments;
  }

  function repair(pattern) {
    if (!pattern.gaps.length) return pattern;
    const segments = segmentsOf(pattern);
    for (const gap of pattern.gaps) {
      segments.push({ a: pattern.pts[gap.i], b: pattern.pts[gap.j] });
    }
    const next = analyze(segments, pattern.tolerance);
    next.repaired = pattern.gaps.length;
    if (pattern.attached) next.attached = pattern.attached;
    if (pattern.nudged) next.nudged = true;
    if (pattern.profile) {
      next.profile = true;
      next.step = pattern.step;
    }
    return next;
  }

  function finish(pattern, extra) {
    extra = extra || {};
    if (extra.open && extra.open.length) pattern.open = pattern.open.concat(extra.open);
    if (extra.repaired) pattern.repaired = extra.repaired;
    if (extra.attached) pattern.attached = extra.attached;
    if (extra.nudged) pattern.nudged = true;
    if (extra.profile) {
      pattern.profile = true;
      pattern.step = extra.step;
    }
    pattern.bounds = boundsOf(pattern);
    return pattern;
  }

  NS.contours = { analyze, repair, finish };
})(typeof window !== "undefined" ? window : globalThis);
