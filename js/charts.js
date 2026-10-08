// Tiny SVG bar charts, no library needed. Both return markup strings.
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Vertical bars: items = [{label, value}] */
export function barChart(items, { title = "", color = "#2457d6" } = {}) {
  const W = 440, H = 220, L = 30, B = 40, T = 12;
  const max = Math.max(1, ...items.map((i) => i.value));
  const step = (W - L - 10) / Math.max(1, items.length);
  const bw = Math.min(40, step * 0.6);
  const bars = items
    .map((it, i) => {
      const h = ((H - B - T) * it.value) / max;
      const x = L + i * step + (step - bw) / 2;
      const y = H - B - h;
      return `<rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="3" fill="${color}"><title>${esc(it.label)}: ${it.value}</title></rect>
        <text x="${x + bw / 2}" y="${y - 4}" text-anchor="middle" font-size="11" fill="currentColor">${it.value}</text>
        <text x="${x + bw / 2}" y="${H - B + 16}" text-anchor="middle" font-size="11" fill="currentColor">${esc(it.label)}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}" class="chart">
    <line x1="${L}" y1="${H - B}" x2="${W - 5}" y2="${H - B}" stroke="currentColor" opacity=".4"/>${bars}</svg>`;
}

/** Horizontal bars: items = [{label, value}] */
export function hBarChart(items, { title = "", color = "#0f8a5f" } = {}) {
  const W = 440, row = 28, L = 110;
  const H = Math.max(60, items.length * row + 12);
  const max = Math.max(1, ...items.map((i) => i.value));
  const bars = items
    .map((it, i) => {
      const w = ((W - L - 40) * it.value) / max;
      const y = 6 + i * row;
      return `<text x="${L - 8}" y="${y + 15}" text-anchor="end" font-size="12" fill="currentColor">${esc(it.label)}</text>
        <rect x="${L}" y="${y + 2}" width="${w}" height="18" rx="3" fill="${color}"><title>${esc(it.label)}: ${it.value}</title></rect>
        <text x="${L + w + 6}" y="${y + 15}" font-size="12" fill="currentColor">${it.value}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}" class="chart">${bars}</svg>`;
}
