// Tiny SVG charts (no library: an extension page may not load remote scripts).
// Every function returns an SVG string, so charts are testable in Node.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function donut(items, { size = 220, thickness = 34, center = "", sub = "" } = {}) {
  const total = items.reduce((a, b) => a + b.value, 0) || 1;
  const r = size / 2 - 4, ri = r - thickness, cx = size / 2, cy = size / 2;
  let a0 = -Math.PI / 2;
  const paths = items.filter((it) => it.value > 0).map((it) => {
    const a1 = a0 + (it.value / total) * Math.PI * 2 - 1e-4;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad, ang) => `${(cx + rad * Math.cos(ang)).toFixed(2)},${(cy + rad * Math.sin(ang)).toFixed(2)}`;
    const d = `M${p(r, a0)} A${r},${r} 0 ${large} 1 ${p(r, a1)} L${p(ri, a1)} A${ri},${ri} 0 ${large} 0 ${p(ri, a0)} Z`;
    a0 = a1 + 1e-4;
    return `<path d="${d}" fill="${it.color}"><title>${esc(it.label)}</title></path>`;
  });
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="chart donut">${paths.join("")}` +
    `<text x="${cx}" y="${cy - 2}" text-anchor="middle" class="donut-center">${esc(center)}</text>` +
    `<text x="${cx}" y="${cy + 18}" text-anchor="middle" class="donut-sub">${esc(sub)}</text></svg>`;
}

// Stacked bars: series = [{label, color, values: [...]}], labels = x labels.
export function stackedBars(labels, series, { width = 520, height = 220, unit = "h", goal = null } = {}) {
  const pad = { l: 34, r: 8, t: 10, b: 26 };
  const W = width - pad.l - pad.r, H = height - pad.t - pad.b;
  const totals = labels.map((_, i) => series.reduce((a, s) => a + (s.values[i] || 0), 0));
  const max = Math.max(1, goal || 0, ...totals) * 1.12;
  const bw = W / labels.length * 0.62;
  const y = (v) => pad.t + H - (v / max) * H;
  let out = `<svg viewBox="0 0 ${width} ${height}" width="100%" class="chart bars">`;
  const ticks = 4;
  for (let k = 0; k <= ticks; k++) {
    const v = (max / 1.12) * k / ticks;
    out += `<line x1="${pad.l}" x2="${width - pad.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/>` +
      `<text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end" class="tick">${v.toFixed(v < 10 ? 1 : 0)}</text>`;
  }
  labels.forEach((lab, i) => {
    const x = pad.l + (i + 0.5) * (W / labels.length) - bw / 2;
    let acc = 0;
    series.forEach((s) => {
      const v = s.values[i] || 0;
      if (v > 0) {
        out += `<rect x="${x.toFixed(1)}" y="${y(acc + v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(y(acc) - y(acc + v)).toFixed(1)}" rx="3" fill="${s.color}"><title>${esc(s.label)}: ${v.toFixed(1)} ${unit}</title></rect>`;
      }
      acc += v;
    });
    if (totals[i] > 0) out += `<text x="${x + bw / 2}" y="${y(totals[i]) - 5}" text-anchor="middle" class="val">${totals[i].toFixed(1)}</text>`;
    out += `<text x="${x + bw / 2}" y="${height - 8}" text-anchor="middle" class="tick">${esc(lab)}</text>`;
  });
  if (goal) out += `<line x1="${pad.l}" x2="${width - pad.r}" y1="${y(goal)}" y2="${y(goal)}" class="goal"/>` +
    `<text x="${width - pad.r}" y="${y(goal) - 5}" text-anchor="end" class="goal-label">goal ${goal} ${unit}</text>`;
  return out + "</svg>";
}

// Line chart with an optional ideal line: points = [{x: label, y}]
export function line(points, { width = 520, height = 220, ideal = null, color = "#4cc9f0" } = {}) {
  const pad = { l: 34, r: 10, t: 10, b: 26 };
  const W = width - pad.l - pad.r, H = height - pad.t - pad.b;
  const max = Math.max(1, ...points.map((p) => p.y), ...(ideal || [])) * 1.1;
  const X = (i) => pad.l + (points.length > 1 ? i / (points.length - 1) : 0.5) * W;
  const Y = (v) => pad.t + H - (v / max) * H;
  let out = `<svg viewBox="0 0 ${width} ${height}" width="100%" class="chart line">`;
  for (let k = 0; k <= 4; k++) {
    const v = (max / 1.1) * k / 4;
    out += `<line x1="${pad.l}" x2="${width - pad.r}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${pad.l - 6}" y="${Y(v) + 4}" text-anchor="end" class="tick">${v.toFixed(0)}</text>`;
  }
  if (ideal) out += `<polyline points="${ideal.map((v, i) => `${X(i)},${Y(v)}`).join(" ")}" class="ideal"/>`;
  out += `<polyline points="${points.map((p, i) => `${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ")}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round"/>`;
  points.forEach((p, i) => {
    out += `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="3.5" fill="${color}"><title>${esc(p.x)}: ${p.y.toFixed(1)}</title></circle>`;
    if (points.length <= 16 || i % 2 === 0) out += `<text x="${X(i)}" y="${height - 8}" text-anchor="middle" class="tick">${esc(p.x)}</text>`;
  });
  return out + "</svg>";
}
