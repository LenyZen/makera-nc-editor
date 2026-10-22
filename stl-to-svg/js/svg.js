(function (root) {
  const NS = root.STL2SVG || (root.STL2SVG = {});

  function num(value) {
    const n = Math.round(value * 1000) / 1000;
    return Object.is(n, -0) ? "0" : String(n);
  }

  function pathData(pts, bounds) {
    const x0 = bounds.minX;
    const y1 = bounds.maxY;
    const parts = pts.map((p, i) => {
      const x = num(p.x - x0);
      const y = num(y1 - p.y);
      return (i === 0 ? "M " : "L ") + x + " " + y;
    });
    parts.push("Z");
    return parts.join(" ");
  }

  function build(pattern, meta) {
    const bounds = pattern.bounds;
    const width = Math.max(0.001, bounds.width);
    const height = Math.max(0.001, bounds.height);
    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<svg xmlns="http://www.w3.org/2000/svg"',
      '  width="' + num(width) + 'mm"',
      '  height="' + num(height) + 'mm"',
      '  viewBox="0 0 ' + num(width) + " " + num(height) + '"',
      '  data-units="mm">',
      "  <title>" + escapeXml(meta.title || "Cutting pattern") + "</title>",
      "  <desc>Millimetres. 1 user unit is 1 mm. Every path is a closed cut. The path is the centre of the line. This file does not offset for a cutter. " + escapeXml(meta.note || "") + "</desc>",
      '  <g id="cuts" fill="none" stroke="#222222" stroke-width="0.05" stroke-linejoin="round" stroke-linecap="round">'
    ];
    const order = { outline: 0, hole: 1, loose: 2 };
    const contours = pattern.closed.slice().sort((a, b) => order[a.role] - order[b.role]);
    const tally = { outline: 0, hole: 0, loose: 0 };
    for (const contour of contours) {
      tally[contour.role] = (tally[contour.role] || 0) + 1;
      const id = contour.role + "-" + tally[contour.role];
      lines.push('    <path id="' + id + '" data-role="' + contour.role + '" d="' + pathData(contour.pts, bounds) + '"/>');
    }
    lines.push("  </g>", "</svg>", "");
    return lines.join("\n");
  }

  function escapeXml(text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  NS.buildSVG = build;
})(typeof window !== "undefined" ? window : globalThis);
