(function (root) {
  const NS = root.STL2SVG || (root.STL2SVG = {});

  function ring(cx, cy, r, z, n, ccw) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (ccw ? i : -i) / n * Math.PI * 2;
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, z });
    }
    return pts;
  }

  function pushTri(list, a, b, c) {
    list.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }

  function addWall(list, bottom, top) {
    const n = bottom.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      pushTri(list, bottom[i], bottom[j], top[j]);
      pushTri(list, bottom[i], top[j], top[i]);
    }
  }

  function at(r, a, z) {
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, z };
  }

  function addAnnulus(list, z, innerR, outerR, n) {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      const p0 = at(innerR, a0, z);
      const p1 = at(innerR, a1, z);
      const q0 = at(outerR, a0, z);
      const q1 = at(outerR, a1, z);
      pushTri(list, p0, q0, q1);
      pushTri(list, p0, q1, p1);
    }
  }

  function addCapWithRecess(list, z, innerR, outerR, recess) {
    const n = 160;
    const rings = 28;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      for (let k = 0; k < rings; k++) {
        const r0 = innerR + (outerR - innerR) * (k / rings);
        const r1 = innerR + (outerR - innerR) * ((k + 1) / rings);
        const cx = Math.cos((a0 + a1) / 2) * ((r0 + r1) / 2);
        const cy = Math.sin((a0 + a1) / 2) * ((r0 + r1) / 2);
        if ((cx - recess.x) ** 2 + (cy - recess.y) ** 2 < recess.r * recess.r) continue;
        const p0 = at(r0, a0, z);
        const p1 = at(r0, a1, z);
        const q0 = at(r1, a0, z);
        const q1 = at(r1, a1, z);
        pushTri(list, p0, q0, q1);
        pushTri(list, p0, q1, p1);
      }
    }
  }

  function addFan(list, loop, center) {
    for (let i = 0; i < loop.length; i++) {
      pushTri(list, center, loop[i], loop[(i + 1) % loop.length]);
    }
  }

  function sampleOrnament() {
    const list = [];
    const n = 96;
    const z0 = 0;
    const z1 = 1.25;
    const recessZ = 0.85;
    const outer0 = ring(0, 0, 25, z0, n, true);
    const outer1 = ring(0, 0, 25, z1, n, true);
    const hole0 = ring(0, 0, 8, z0, n, true);
    const hole1 = ring(0, 0, 8, z1, n, true);
    const island0 = ring(0, 0, 4, z0, n, true);
    const island1 = ring(0, 0, 4, z1, n, true);
    const recess0 = ring(14, 0, 3, recessZ, 64, true);
    const recess1 = ring(14, 0, 3, z1, 64, true);
    addWall(list, outer0, outer1);
    addWall(list, hole0, hole1);
    addWall(list, island0, island1);
    addWall(list, recess0, recess1);
    addAnnulus(list, z0, 8, 25, n);
    addCapWithRecess(list, z1, 8, 25, { x: 14, y: 0, r: 3 });
    addFan(list, island0, { x: 0, y: 0, z: z0 });
    addFan(list, island1, { x: 0, y: 0, z: z1 });
    addFan(list, recess0, { x: 14, y: 0, z: recessZ });
    return {
      positions: Float32Array.from(list),
      triangles: list.length / 9,
      name: "sample-ornament",
      note: "50 mm disk, 1.25 mm thick. A through hole holds a loose inner disk. A recess on the right is 0.40 mm deep and does not go through."
    };
  }

  NS.sampleOrnament = sampleOrnament;
})(typeof window !== "undefined" ? window : globalThis);
