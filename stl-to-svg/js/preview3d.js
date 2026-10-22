(function (root) {
  const NS = root.STL2SVG || (root.STL2SVG = {});
  const G = NS.geom;

  const MESH_VS = `
    attribute vec3 aPos;
    attribute vec3 aNrm;
    uniform mat4 uView;
    uniform mat4 uProj;
    varying vec3 vN;
    void main() {
      vec4 viewPos = uView * vec4(aPos, 1.0);
      vN = mat3(uView) * aNrm;
      gl_Position = uProj * viewPos;
    }`;
  const MESH_FS = `
    precision mediump float;
    varying vec3 vN;
    uniform vec3 uColor;
    void main() {
      vec3 n = normalize(vN);
      float key = abs(dot(n, normalize(vec3(-0.28, 0.72, 0.58))));
      float fill = abs(dot(n, normalize(vec3(0.55, -0.25, 0.35))));
      float shade = clamp(0.42 + 0.62 * key + 0.16 * fill, 0.0, 1.15);
      gl_FragColor = vec4(uColor * shade, 1.0);
    }`;
  const LINE_VS = `
    attribute vec3 aPos;
    uniform mat4 uView;
    uniform mat4 uProj;
    void main() {
      gl_Position = uProj * uView * vec4(aPos, 1.0);
    }`;
  const LINE_FS = `
    precision mediump float;
    uniform vec3 uColor;
    void main() { gl_FragColor = vec4(uColor, 1.0); }`;

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || "Shader failed");
    }
    return shader;
  }

  function program(gl, vs, fs) {
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(prog) || "Program failed");
    }
    return prog;
  }

  function lookAt(eye, target, up) {
    const zaxis = G.norm(G.sub(eye, target));
    let xaxis = G.cross(up, zaxis);
    const xl = G.len(xaxis);
    if (xl < 1e-6) xaxis = { x: 1, y: 0, z: 0 };
    else xaxis = G.mul(xaxis, 1 / xl);
    const yaxis = G.cross(zaxis, xaxis);
    return new Float32Array([
      xaxis.x, yaxis.x, zaxis.x, 0,
      xaxis.y, yaxis.y, zaxis.y, 0,
      xaxis.z, yaxis.z, zaxis.z, 0,
      -G.dot(xaxis, eye), -G.dot(yaxis, eye), -G.dot(zaxis, eye), 1
    ]);
  }

  function perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0
    ]);
  }

  function mount(canvas) {
    const gl = canvas.getContext("webgl", { antialias: true, alpha: false });
    if (!gl) return { failed: true, resize() {}, setMesh() {}, setPlane() {}, setView() {}, setPalette() {}, fit() {}, getCamera() { return { yaw: 0, pitch: Math.PI / 2 }; }, redraw() {} };
    const meshProg = program(gl, MESH_VS, MESH_FS);
    const lineProg = program(gl, LINE_VS, LINE_FS);
    const meshLoc = {
      pos: gl.getAttribLocation(meshProg, "aPos"),
      nrm: gl.getAttribLocation(meshProg, "aNrm"),
      view: gl.getUniformLocation(meshProg, "uView"),
      proj: gl.getUniformLocation(meshProg, "uProj"),
      color: gl.getUniformLocation(meshProg, "uColor")
    };
    const lineLoc = {
      pos: gl.getAttribLocation(lineProg, "aPos"),
      view: gl.getUniformLocation(lineProg, "uView"),
      proj: gl.getUniformLocation(lineProg, "uProj"),
      color: gl.getUniformLocation(lineProg, "uColor")
    };
    const posBuf = gl.createBuffer();
    const nrmBuf = gl.createBuffer();
    const lineBuf = gl.createBuffer();
    const state = {
      count: 0,
      yaw: 0.6,
      pitch: 0.5,
      distScale: 1,
      target: { x: 0, y: 0, z: 0 },
      radius: 10,
      basis: NS.geom.preset("top"),
      height: 0,
      showPlane: false,
      paper: [0.953, 0.937, 0.902],
      mesh: [0.62, 0.70, 0.73],
      plane: [0.72, 0.24, 0.18]
    };
    let drag = null;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round((canvas.clientWidth || 300) * dpr));
      canvas.height = Math.max(1, Math.round((canvas.clientHeight || 300) * dpr));
      draw();
    }

    function setMesh(positions) {
      const count = positions.length / 3;
      const normals = new Float32Array(positions.length);
      for (let i = 0; i < positions.length; i += 9) {
        const ax = positions[i + 3] - positions[i];
        const ay = positions[i + 4] - positions[i + 1];
        const az = positions[i + 5] - positions[i + 2];
        const bx = positions[i + 6] - positions[i];
        const by = positions[i + 7] - positions[i + 1];
        const bz = positions[i + 8] - positions[i + 2];
        const n = G.norm({ x: ay * bz - az * by, y: az * bx - ax * bz, z: ax * by - ay * bx });
        for (let k = 0; k < 3; k++) {
          normals[i + k * 3] = n.x;
          normals[i + k * 3 + 1] = n.y;
          normals[i + k * 3 + 2] = n.z;
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuf);
      gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
      state.count = count;
      const box = NS.geom.boundsOf(positions);
      state.target = {
        x: (box.min.x + box.max.x) / 2,
        y: (box.min.y + box.max.y) / 2,
        z: (box.min.z + box.max.z) / 2
      };
      state.radius = G.len(G.mul(G.sub(box.max, box.min), 0.5)) || 1;
      state.distScale = 1;
      draw();
    }

    function setPlane(basis, height) {
      state.basis = basis;
      state.height = height;
      state.showPlane = true;
      const reach = state.radius * 1.35;
      const origin = G.add(state.target, G.mul(basis.normal, height - G.dot(state.target, basis.normal)));
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      const data = new Float32Array(16 * 3);
      for (let i = 0; i < 4; i++) {
        const a = corners[i], b = corners[(i + 1) % 4];
        const pa = G.add(origin, G.add(G.mul(basis.right, a[0] * reach), G.mul(basis.up, a[1] * reach)));
        const pb = G.add(origin, G.add(G.mul(basis.right, b[0] * reach), G.mul(basis.up, b[1] * reach)));
        const o = i * 6;
        data[o] = pa.x; data[o + 1] = pa.y; data[o + 2] = pa.z;
        data[o + 3] = pb.x; data[o + 4] = pb.y; data[o + 5] = pb.z;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      draw();
    }

    function eyeOf() {
      const dist = (state.radius / Math.sin(0.45)) * 1.35 * state.distScale;
      const cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
      return G.add(state.target, {
        x: dist * cp * Math.sin(state.yaw),
        y: dist * -cp * Math.cos(state.yaw),
        z: dist * sp
      });
    }

    function draw() {
      const w = canvas.width, h = canvas.height;
      gl.viewport(0, 0, w, h);
      gl.clearColor(state.paper[0], state.paper[1], state.paper[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      if (!state.count) return;
      const eye = eyeOf();
      const up = Math.abs(state.pitch) > 1.45 ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
      const view = lookAt(eye, state.target, up);
      const aspect = w / Math.max(1, h);
      const dist = G.len(G.sub(eye, state.target));
      const proj = perspective(0.7, aspect, Math.max(0.05, dist * 0.01), dist + state.radius * 8);
      gl.useProgram(meshProg);
      gl.uniformMatrix4fv(meshLoc.view, false, view);
      gl.uniformMatrix4fv(meshLoc.proj, false, proj);
      gl.uniform3f(meshLoc.color, state.mesh[0], state.mesh[1], state.mesh[2]);
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.enableVertexAttribArray(meshLoc.pos);
      gl.vertexAttribPointer(meshLoc.pos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuf);
      gl.enableVertexAttribArray(meshLoc.nrm);
      gl.vertexAttribPointer(meshLoc.nrm, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, state.count);
      if (state.showPlane) {
        gl.useProgram(lineProg);
        gl.uniformMatrix4fv(lineLoc.view, false, view);
        gl.uniformMatrix4fv(lineLoc.proj, false, proj);
        gl.uniform3f(lineLoc.color, state.plane[0], state.plane[1], state.plane[2]);
        gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
        gl.enableVertexAttribArray(lineLoc.pos);
        gl.vertexAttribPointer(lineLoc.pos, 3, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.LINES, 0, 8);
      }
    }

    function setView(name) {
      if (name === "front") { state.yaw = 0; state.pitch = 0; }
      else if (name === "side") { state.yaw = Math.PI / 2; state.pitch = 0; }
      else { state.yaw = 0; state.pitch = Math.PI / 2; }
      state.distScale = 1;
      draw();
    }

    canvas.addEventListener("pointerdown", (event) => {
      try { canvas.setPointerCapture(event.pointerId); } catch (e) {}
      drag = { x: event.clientX, y: event.clientY, yaw: state.yaw, pitch: state.pitch };
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!drag) return;
      state.yaw = drag.yaw - (event.clientX - drag.x) * 0.008;
      state.pitch = Math.max(-1.45, Math.min(1.45, drag.pitch + (event.clientY - drag.y) * 0.008));
      draw();
    });
    canvas.addEventListener("pointerup", () => { drag = null; });
    canvas.addEventListener("pointercancel", () => { drag = null; });
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      state.distScale = Math.max(0.25, Math.min(8, state.distScale * (event.deltaY < 0 ? 0.9 : 1.1)));
      draw();
    }, { passive: false });
    canvas.addEventListener("dblclick", () => { state.distScale = 1; draw(); });

    return {
      failed: false,
      resize,
      setMesh,
      setPlane,
      setView,
      fit() { state.distScale = 1; draw(); },
      getCamera() { return { yaw: state.yaw, pitch: state.pitch }; },
      redraw: draw,
      setPalette(next) {
        if (next.paper) state.paper = next.paper;
        if (next.mesh) state.mesh = next.mesh;
        if (next.plane) state.plane = next.plane;
        draw();
      }
    };
  }

  NS.preview3d = { mount };
})(typeof window !== "undefined" ? window : globalThis);
