(function (root) {
  const NS = root.STL2SVG || (root.STL2SVG = {});

  function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
  function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
  function mul(a, s) { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
  function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function cross(a, b) {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
  }
  function len(a) { return Math.hypot(a.x, a.y, a.z); }
  function norm(a) {
    const l = len(a) || 1;
    return { x: a.x / l, y: a.y / l, z: a.z / l };
  }

  function centerOf(positions) {
    let x = 0, y = 0, z = 0;
    const n = positions.length / 3;
    for (let i = 0; i < positions.length; i += 3) {
      x += positions[i];
      y += positions[i + 1];
      z += positions[i + 2];
    }
    return { x: x / n, y: y / n, z: z / n };
  }

  function boundsOf(positions) {
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i], y = positions[i + 1], z = positions[i + 2];
      if (x < min.x) min.x = x;
      if (y < min.y) min.y = y;
      if (z < min.z) min.z = z;
      if (x > max.x) max.x = x;
      if (y > max.y) max.y = y;
      if (z > max.z) max.z = z;
    }
    return { min, max };
  }

  function transform(positions, rx, ry, rz, scale) {
    const c = centerOf(positions);
    const out = new Float32Array(positions.length);
    const ax = rx * Math.PI / 180, ay = ry * Math.PI / 180, az = rz * Math.PI / 180;
    const cx = Math.cos(ax), sx = Math.sin(ax);
    const cy = Math.cos(ay), sy = Math.sin(ay);
    const cz = Math.cos(az), sz = Math.sin(az);
    for (let i = 0; i < positions.length; i += 3) {
      let x = (positions[i] - c.x) * scale;
      let y = (positions[i + 1] - c.y) * scale;
      let z = (positions[i + 2] - c.z) * scale;
      const y1 = y * cx - z * sx;
      const z1 = y * sx + z * cx;
      y = y1;
      z = z1;
      const x2 = x * cy + z * sy;
      const z2 = -x * sy + z * cy;
      x = x2;
      z = z2;
      const x3 = x * cz - y * sz;
      const y3 = x * sz + y * cz;
      out[i] = x3 + c.x;
      out[i + 1] = y3 + c.y;
      out[i + 2] = z + c.z;
    }
    return out;
  }

  function rangeAlong(positions, normal) {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      const d = positions[i] * normal.x + positions[i + 1] * normal.y + positions[i + 2] * normal.z;
      if (d < min) min = d;
      if (d > max) max = d;
    }
    return { min, max };
  }

  function basisFromAngles(yaw, pitch) {
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    const normal = norm({ x: cp * sy, y: -cp * cy, z: sp });
    const forward = mul(normal, -1);
    let up = Math.abs(normal.z) > 0.98 ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
    let right = cross(forward, up);
    const rl = len(right);
    if (rl < 1e-6) right = { x: 1, y: 0, z: 0 };
    else right = mul(right, 1 / rl);
    up = norm(cross(right, forward));
    return { normal, right, up };
  }

  function preset(name) {
    if (name === "front") return basisFromAngles(0, 0);
    if (name === "side") return basisFromAngles(Math.PI / 2, 0);
    return basisFromAngles(0, Math.PI / 2);
  }

  NS.geom = {
    add, sub, mul, dot, cross, len, norm,
    centerOf, boundsOf, transform, rangeAlong, basisFromAngles, preset
  };
})(typeof window !== "undefined" ? window : globalThis);
