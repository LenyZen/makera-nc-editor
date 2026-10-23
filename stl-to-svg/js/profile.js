(function (root) {
  const NS = root.STL2SVG || (root.STL2SVG = {});

  function project(positions, basis) {
    const { right, up } = basis;
    const tris = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const pos = positions;
    for (let i = 0; i < pos.length; i += 9) {
      const p = [0, 1, 2].map((k) => {
        const o = i + k * 3;
        const v = { x: pos[o], y: pos[o + 1], z: pos[o + 2] };
        return { x: NS.geom.dot(v, right), y: NS.geom.dot(v, up) };
      });
      const area = (p[1].x - p[0].x) * (p[2].y - p[0].y) - (p[1].y - p[0].y) * (p[2].x - p[0].x);
      if (Math.abs(area) < 1e-12) continue;
      tris.push(p);
      for (const q of p) {
        if (q.x < minX) minX = q.x;
        if (q.y < minY) minY = q.y;
        if (q.x > maxX) maxX = q.x;
        if (q.y > maxY) maxY = q.y;
      }
    }
    return { tris, minX, minY, maxX, maxY };
  }

  function fillTriangle(grid, cols, rows, ox, oy, step, tri) {
    const a = tri[0], b = tri[1], c = tri[2];
    const minX = Math.min(a.x, b.x, c.x);
    const maxX = Math.max(a.x, b.x, c.x);
    const minY = Math.min(a.y, b.y, c.y);
    const maxY = Math.max(a.y, b.y, c.y);
    let i0 = Math.floor((minX - ox) / step);
    let i1 = Math.floor((maxX - ox) / step);
    let j0 = Math.floor((minY - oy) / step);
    let j1 = Math.floor((maxY - oy) / step);
    if (i0 < 1) i0 = 1;
    if (j0 < 1) j0 = 1;
    if (i1 > cols - 2) i1 = cols - 2;
    if (j1 > rows - 2) j1 = rows - 2;
    if (i0 > i1 || j0 > j1) return;
    const denom = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(denom) < 1e-14) return;
    const inv = 1 / denom;
    for (let j = j0; j <= j1; j++) {
      const py = oy + (j + 0.5) * step;
      const row = j * cols;
      for (let i = i0; i <= i1; i++) {
        if (grid[row + i]) continue;
        const px = ox + (i + 0.5) * step;
        const w0 = ((b.y - c.y) * (px - c.x) + (c.x - b.x) * (py - c.y)) * inv;
        const w1 = ((c.y - a.y) * (px - c.x) + (a.x - c.x) * (py - c.y)) * inv;
        if (w0 >= 0 && w1 >= 0 && (w0 + w1) <= 1) grid[row + i] = 1;
      }
    }
  }

  function raster(tris, box) {
    const span = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1e-6);
    let step = Math.max(span / 1400, 1e-4);
    function size(s) {
      const cols = Math.ceil((box.maxX - box.minX) / s) + 3;
      const rows = Math.ceil((box.maxY - box.minY) / s) + 3;
      return { cols, rows };
    }
    let dims = size(step);
    if (dims.cols * dims.rows > 1400 * 1400) {
      step *= Math.sqrt((dims.cols * dims.rows) / (1400 * 1400));
      dims = size(step);
    }
    const ox = box.minX - step;
    const oy = box.minY - step;
    const grid = new Uint8Array(dims.cols * dims.rows);
    for (const tri of tris) fillTriangle(grid, dims.cols, dims.rows, ox, oy, step, tri);
    return { grid, cols: dims.cols, rows: dims.rows, ox, oy, step };
  }

  function boundarySegments(field) {
    const { grid, cols, rows, ox, oy, step } = field;
    const segments = [];
    function at(i, j) {
      return { x: ox + i * step, y: oy + j * step };
    }
    for (let j = 1; j < rows - 1; j++) {
      const row = j * cols;
      for (let i = 1; i < cols - 1; i++) {
        if (!grid[row + i]) continue;
        if (!grid[row + i - 1]) segments.push({ a: at(i, j), b: at(i, j + 1) });
        if (!grid[row + i + 1]) segments.push({ a: at(i + 1, j), b: at(i + 1, j + 1) });
        if (!grid[row - cols + i]) segments.push({ a: at(i, j), b: at(i + 1, j) });
        if (!grid[row + cols + i]) segments.push({ a: at(i, j + 1), b: at(i + 1, j + 1) });
      }
    }
    return segments;
  }

  function chain(segments, step) {
    const pts = [];
    const index = new Map();
    function idOf(p) {
      const k = Math.round(p.x / step) + "," + Math.round(p.y / step);
      let id = index.get(k);
      if (id === undefined) {
        id = pts.length;
        pts.push({ x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step });
        index.set(k, id);
      }
      return id;
    }
    const adj = [];
    const edges = [];
    for (const seg of segments) {
      const a = idOf(seg.a);
      const b = idOf(seg.b);
      if (a === b) continue;
      const ei = edges.length;
      edges.push([a, b]);
      if (!adj[a]) adj[a] = [];
      if (!adj[b]) adj[b] = [];
      adj[a].push({ to: b, ei });
      adj[b].push({ to: a, ei });
    }
    const used = new Array(edges.length).fill(false);
    function stepFrom(prev, curr) {
      const options = (adj[curr] || []).filter((o) => !used[o.ei]);
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
    const loops = [];
    for (let ei = 0; ei < edges.length; ei++) {
      if (used[ei]) continue;
      used[ei] = true;
      const start = edges[ei][0];
      let prev = start;
      let curr = edges[ei][1];
      const loop = [pts[start], pts[curr]];
      let guard = 0;
      let closed = false;
      while (guard++ < edges.length + 2) {
        if (curr === start) {
          closed = true;
          loop.pop();
          break;
        }
        const next = stepFrom(prev, curr);
        if (next === null) break;
        prev = curr;
        curr = next;
        if (curr === start) {
          closed = true;
          break;
        }
        loop.push(pts[curr]);
      }
      if (closed && loop.length >= 3) loops.push(loop);
    }
    return loops;
  }

  function dp(pts, eps) {
    const keep = new Array(pts.length).fill(false);
    keep[0] = keep[pts.length - 1] = true;
    const eps2 = eps * eps;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const pair = stack.pop();
      const a = pair[0];
      const b = pair[1];
      if (b <= a + 1) continue;
      const ax = pts[a].x, ay = pts[a].y;
      const bx = pts[b].x, by = pts[b].y;
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy || 1;
      let far = -1;
      let best = 0;
      for (let i = a + 1; i < b; i++) {
        const cross = (pts[i].x - ax) * dy - (pts[i].y - ay) * dx;
        const dist = (cross * cross) / len2;
        if (dist > best) {
          best = dist;
          far = i;
        }
      }
      if (far >= 0 && best > eps2) {
        keep[far] = true;
        stack.push([a, far], [far, b]);
      }
    }
    const out = [];
    for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
    return out;
  }

  function simplifyClosed(pts, eps) {
    if (pts.length < 8) return pts.slice();
    let cx = 0, cy = 0;
    for (const p of pts) {
      cx += p.x;
      cy += p.y;
    }
    cx /= pts.length;
    cy /= pts.length;
    let far = 0;
    let best = -1;
    for (let i = 0; i < pts.length; i++) {
      const d = (pts[i].x - cx) ** 2 + (pts[i].y - cy) ** 2;
      if (d > best) {
        best = d;
        far = i;
      }
    }
    const rotated = pts.slice(far).concat(pts.slice(0, far));
    const simple = dp(rotated, eps);
    return simple.length >= 3 ? simple : pts.slice();
  }

  function loopArea(pts) {
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      area += a.x * b.y - b.x * a.y;
    }
    return Math.abs(area) / 2;
  }

  function profileMesh(positions, basis) {
    const projected = project(positions, basis);
    if (!projected.tris.length) return { segments: [], step: 0 };
    const field = raster(projected.tris, projected);
    const loops = chain(boundarySegments(field), field.step);
    const span = Math.max(projected.maxX - projected.minX, projected.maxY - projected.minY, field.step);
    const dust = field.step * field.step * 4;
    const eps = Math.min(Math.max(field.step * 0.85, 0.05), Math.max(field.step * 3, span * 0.004));
    const segments = [];
    for (const loop of loops) {
      if (loopArea(loop) < dust) continue;
      const simple = simplifyClosed(loop, eps);
      if (simple.length < 3 || loopArea(simple) < dust) continue;
      for (let i = 0; i < simple.length; i++) {
        segments.push({ a: simple[i], b: simple[(i + 1) % simple.length] });
      }
    }
    return { segments, step: field.step, error: eps };
  }

  NS.profileMesh = profileMesh;
})(typeof window !== "undefined" ? window : globalThis);
