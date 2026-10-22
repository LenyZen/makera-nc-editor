(function (root) {
  const NS = root.STL2SVG || (root.STL2SVG = {});

  function parseASCII(text) {
    const re = /vertex\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
    const nums = [];
    let match;
    while ((match = re.exec(text))) {
      nums.push(parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3]));
    }
    if (nums.length < 9 || nums.length % 9 !== 0) {
      throw new Error("This ASCII STL has no complete triangles.");
    }
    return { positions: Float32Array.from(nums), triangles: nums.length / 9, format: "ascii" };
  }

  function parseBinary(buffer) {
    const view = new DataView(buffer);
    const count = view.getUint32(80, true);
    const positions = new Float32Array(count * 9);
    let offset = 84;
    let p = 0;
    for (let i = 0; i < count; i++) {
      offset += 12;
      for (let v = 0; v < 9; v++) {
        positions[p++] = view.getFloat32(offset, true);
        offset += 4;
      }
      offset += 2;
    }
    return { positions, triangles: count, format: "binary" };
  }

  function parse(buffer) {
    if (!buffer || buffer.byteLength < 84) {
      throw new Error("This file is too small to be an STL.");
    }
    const view = new DataView(buffer);
    const count = view.getUint32(80, true);
    const binaryBytes = 84 + count * 50;
    const head = new TextDecoder("latin1").decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 80)));
    const looksSolid = /^\s*solid/i.test(head);
    if (count > 0 && buffer.byteLength === binaryBytes) return parseBinary(buffer);
    if (looksSolid || buffer.byteLength < binaryBytes) {
      const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
      if (/facet/i.test(text) && /vertex/i.test(text)) return parseASCII(text);
    }
    if (count > 0 && buffer.byteLength > binaryBytes && buffer.byteLength < binaryBytes + 512) {
      return parseBinary(buffer.slice(0, binaryBytes));
    }
    throw new Error("This file is not a binary or ASCII STL.");
  }

  NS.parseSTL = parse;
})(typeof window !== "undefined" ? window : globalThis);
