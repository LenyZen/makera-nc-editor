(function (root) {
  const NS = root.STL2SVG || (root.STL2SVG = {});

  const PLANE_EPS = 1e-5;

  function slice(positions, basis, height) {
    const { normal, right, up } = basis;
    const span = NS.geom.rangeAlong(positions, normal);
    let z = height;
    let nudged = false;
    const pad = Math.max(1e-4, (span.max - span.min) * 1e-5);
    if (z <= span.min + pad) {
      z = span.min + pad;
      nudged = true;
    } else if (z >= span.max - pad) {
      z = span.max - pad;
      nudged = true;
    }
    const segments = [];
    const pos = positions;
    for (let i = 0; i < pos.length; i += 9) {
      const verts = [
        { x: pos[i], y: pos[i + 1], z: pos[i + 2] },
        { x: pos[i + 3], y: pos[i + 4], z: pos[i + 5] },
        { x: pos[i + 6], y: pos[i + 7], z: pos[i + 8] }
      ];
      const d = verts.map((v) => NS.geom.dot(v, normal) - z);
      const hits = [];
      for (let e = 0; e < 3; e++) {
        const a = e;
        const b = (e + 1) % 3;
        const da = d[a];
        const db = d[b];
        if (Math.abs(da) <= PLANE_EPS && Math.abs(db) <= PLANE_EPS) continue;
        if (Math.abs(da) <= PLANE_EPS) {
          hits.push(verts[a]);
          continue;
        }
        if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
          const t = da / (da - db);
          hits.push({
            x: verts[a].x + (verts[b].x - verts[a].x) * t,
            y: verts[a].y + (verts[b].y - verts[a].y) * t,
            z: verts[a].z + (verts[b].z - verts[a].z) * t
          });
        }
      }
      const flat = [];
      for (const hit of hits) {
        const p = { x: NS.geom.dot(hit, right), y: NS.geom.dot(hit, up) };
        if (!flat.some((q) => (q.x - p.x) ** 2 + (q.y - p.y) ** 2 < 1e-12)) flat.push(p);
      }
      if (flat.length >= 2) segments.push({ a: flat[0], b: flat[1] });
    }
    return { segments, height: z, nudged, span };
  }

  NS.sliceMesh = slice;
})(typeof window !== "undefined" ? window : globalThis);
