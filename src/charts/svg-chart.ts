import { ChartData, BarChartData } from "../types/chart.js";

const MARGIN = { top: 40, right: 20, bottom: 80, left: 70 };

export const COLOR_PALETTE = [
  "#1f77b4", // blue
  "#ff7f0e", // orange
  "#2ca02c", // green
  "#d62728", // red
  "#9467bd", // purple
  "#8c564b", // brown
  "#e377c2", // pink
  "#7f7f7f", // gray
  "#bcbd22", // olive
  "#17becf", // cyan
];

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Compute "nice" axis bounds and tick step for a value range.
 * Returns min/max/step such that ticks land on round numbers.
 */
function computeNiceScale(
  dataMin: number,
  dataMax: number,
  maxTicks: number
): { min: number; max: number; step: number } {
  if (dataMin === dataMax) {
    // Constant value — create a range around it
    const pad = dataMin === 0 ? 1 : Math.abs(dataMin) * 0.1;
    return computeNiceScale(dataMin - pad, dataMax + pad, maxTicks);
  }

  const range = dataMax - dataMin;
  const roughStep = range / (maxTicks - 1);

  // Round step to a nice number (1, 2, 5, 10, 20, 50, ...)
  const mag = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const residual = roughStep / mag;
  let niceStep: number;
  if (residual <= 1.5) niceStep = 1 * mag;
  else if (residual <= 3) niceStep = 2 * mag;
  else if (residual <= 7) niceStep = 5 * mag;
  else niceStep = 10 * mag;

  const niceMin = Math.floor(dataMin / niceStep) * niceStep;
  const niceMax = Math.ceil(dataMax / niceStep) * niceStep;

  return { min: niceMin, max: niceMax, step: niceStep };
}

function formatValueLabel(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return (value / 1e9).toFixed(1) + "B";
  if (abs >= 1e6) return (value / 1e6).toFixed(1) + "M";
  if (abs >= 1e4) return (value / 1e3).toFixed(1) + "K";
  if (abs >= 100) return Math.round(value).toString();
  if (abs >= 1) return value.toFixed(1);
  if (abs >= 0.01) return value.toFixed(2);
  if (value === 0) return "0";
  return value.toExponential(1);
}

function formatTimeLabel(ts: number, spanMs: number): string {
  const d = new Date(ts);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");

  // For spans < 5 minutes, show seconds
  if (spanMs < 5 * 60_000) return `${hh}:${mm}:${ss}`;
  // For spans > 24 hours, show date
  if (spanMs > 24 * 3600_000) {
    const mon = (d.getMonth() + 1).toString().padStart(2, "0");
    const day = d.getDate().toString().padStart(2, "0");
    return `${mon}/${day} ${hh}:${mm}`;
  }
  return `${hh}:${mm}`;
}

/**
 * Generate an SVG line chart from the given chart data.
 * Returns null if there is no renderable data.
 */
export function generateLineChartSvg(data: ChartData): string | null {
  const validSeries = data.series.filter(s => s.timestamps.length > 0);
  if (validSeries.length === 0) return null;

  const { width, height } = data;
  const chartW = width - MARGIN.left - MARGIN.right;
  const chartH = height - MARGIN.top - MARGIN.bottom;

  // Compute global time range
  let minTime = Infinity, maxTime = -Infinity;
  let minVal = Infinity, maxVal = -Infinity;
  for (const s of validSeries) {
    for (const t of s.timestamps) {
      if (t < minTime) minTime = t;
      if (t > maxTime) maxTime = t;
    }
    for (const v of s.values) {
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
    }
  }

  if (minTime === maxTime) {
    // Single timestamp — pad by 1 minute each side
    minTime -= 60_000;
    maxTime += 60_000;
  }

  const yScale = computeNiceScale(minVal, maxVal, 6);
  const timeSpan = maxTime - minTime;

  // Coordinate mappers
  const mapX = (t: number) => MARGIN.left + ((t - minTime) / timeSpan) * chartW;
  const mapY = (v: number) => MARGIN.top + chartH - ((v - yScale.min) / (yScale.max - yScale.min)) * chartH;

  const parts: string[] = [];

  // SVG header
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="monospace" font-size="11">`
  );

  // Background
  parts.push(`<rect width="${width}" height="${height}" fill="#fafafa"/>`);

  // Title
  parts.push(
    `<text x="${width / 2}" y="24" text-anchor="middle" font-size="14" font-weight="bold" fill="#333">${escapeXml(data.title)}</text>`
  );

  // Y-axis grid lines and labels
  for (let v = yScale.min; v <= yScale.max + yScale.step * 0.001; v += yScale.step) {
    const y = mapY(v);
    parts.push(
      `<line x1="${MARGIN.left}" y1="${y}" x2="${width - MARGIN.right}" y2="${y}" stroke="#e0e0e0" stroke-dasharray="4,3"/>`
    );
    parts.push(
      `<text x="${MARGIN.left - 8}" y="${y + 4}" text-anchor="end" fill="#666" font-size="10">${escapeXml(formatValueLabel(v))}</text>`
    );
  }

  // X-axis labels
  const xTickCount = Math.min(7, Math.max(2, Math.floor(chartW / 100)));
  for (let i = 0; i < xTickCount; i++) {
    const t = minTime + (timeSpan * i) / (xTickCount - 1);
    const x = mapX(t);
    parts.push(
      `<line x1="${x}" y1="${MARGIN.top + chartH}" x2="${x}" y2="${MARGIN.top + chartH + 5}" stroke="#999"/>`
    );
    parts.push(
      `<text x="${x}" y="${MARGIN.top + chartH + 18}" text-anchor="middle" fill="#666" font-size="10">${escapeXml(formatTimeLabel(t, timeSpan))}</text>`
    );
  }

  // Axis lines
  parts.push(
    `<line x1="${MARGIN.left}" y1="${MARGIN.top}" x2="${MARGIN.left}" y2="${MARGIN.top + chartH}" stroke="#999"/>`
  );
  parts.push(
    `<line x1="${MARGIN.left}" y1="${MARGIN.top + chartH}" x2="${width - MARGIN.right}" y2="${MARGIN.top + chartH}" stroke="#999"/>`
  );

  // Data lines
  for (const series of validSeries) {
    if (series.timestamps.length === 1) {
      // Single point — render as circle
      const cx = mapX(series.timestamps[0]);
      const cy = mapY(series.values[0]);
      parts.push(`<circle cx="${cx}" cy="${cy}" r="4" fill="${series.color}"/>`);
    } else {
      const points = series.timestamps
        .map((t, i) => `${mapX(t).toFixed(1)},${mapY(series.values[i]).toFixed(1)}`)
        .join(" ");
      parts.push(
        `<polyline points="${points}" fill="none" stroke="${series.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
      );
    }
  }

  // Legend (below chart)
  const legendY = MARGIN.top + chartH + 36;
  const legendItemWidth = 160;
  const itemsPerRow = Math.max(1, Math.floor(chartW / legendItemWidth));

  for (let i = 0; i < validSeries.length; i++) {
    const row = Math.floor(i / itemsPerRow);
    const col = i % itemsPerRow;
    const lx = MARGIN.left + col * legendItemWidth;
    const ly = legendY + row * 16;

    parts.push(`<rect x="${lx}" y="${ly - 8}" width="10" height="10" fill="${validSeries[i].color}" rx="2"/>`);

    // Truncate long labels
    let label = validSeries[i].label;
    if (label.length > 22) label = label.substring(0, 20) + "…";
    parts.push(
      `<text x="${lx + 14}" y="${ly}" fill="#333" font-size="10">${escapeXml(label)}</text>`
    );
  }

  parts.push("</svg>");
  return parts.join("\n");
}

const BAR_MARGIN = { top: 40, right: 20, bottom: 60, left: 70 };

/**
 * Generate an SVG horizontal bar chart from categorical data.
 * Returns null if there are no items.
 */
export function generateBarChartSvg(data: BarChartData): string | null {
  if (data.items.length === 0) return null;

  const { width, height } = data;
  const chartW = width - BAR_MARGIN.left - BAR_MARGIN.right;
  const chartH = height - BAR_MARGIN.top - BAR_MARGIN.bottom;

  const maxVal = Math.max(...data.items.map(d => d.value));
  const xScale = computeNiceScale(0, maxVal, 6);

  const barCount = data.items.length;
  const barGap = 4;
  const barHeight = Math.min(30, Math.max(10, (chartH - barGap * (barCount - 1)) / barCount));
  const totalBarsHeight = barCount * barHeight + (barCount - 1) * barGap;
  const startY = BAR_MARGIN.top + (chartH - totalBarsHeight) / 2;

  const mapX = (v: number) => BAR_MARGIN.left + (v / xScale.max) * chartW;

  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="monospace" font-size="11">`
  );

  // Background
  parts.push(`<rect width="${width}" height="${height}" fill="#fafafa"/>`);

  // Title
  parts.push(
    `<text x="${width / 2}" y="24" text-anchor="middle" font-size="14" font-weight="bold" fill="#333">${escapeXml(data.title)}</text>`
  );

  // X-axis grid lines and labels
  for (let v = xScale.min; v <= xScale.max + xScale.step * 0.001; v += xScale.step) {
    const x = mapX(v);
    parts.push(
      `<line x1="${x}" y1="${BAR_MARGIN.top}" x2="${x}" y2="${BAR_MARGIN.top + chartH}" stroke="#e0e0e0" stroke-dasharray="4,3"/>`
    );
    parts.push(
      `<text x="${x}" y="${BAR_MARGIN.top + chartH + 16}" text-anchor="middle" fill="#666" font-size="10">${escapeXml(formatValueLabel(v))}</text>`
    );
  }

  // Value axis label
  parts.push(
    `<text x="${width / 2}" y="${height - 8}" text-anchor="middle" fill="#666" font-size="10">${escapeXml(data.valueLabel)}</text>`
  );

  // Bars
  for (let i = 0; i < barCount; i++) {
    const item = data.items[i];
    const by = startY + i * (barHeight + barGap);
    const bw = Math.max(1, (item.value / xScale.max) * chartW);

    parts.push(
      `<rect x="${BAR_MARGIN.left}" y="${by}" width="${bw.toFixed(1)}" height="${barHeight}" fill="${item.color}" rx="2"/>`
    );

    // Category label (to the left of the bar)
    let label = item.label;
    if (label.length > 18) label = label.substring(0, 16) + "…";
    parts.push(
      `<text x="${BAR_MARGIN.left - 6}" y="${by + barHeight / 2 + 4}" text-anchor="end" fill="#333" font-size="10">${escapeXml(label)}</text>`
    );

    // Value label (at the end of the bar)
    parts.push(
      `<text x="${BAR_MARGIN.left + bw + 4}" y="${by + barHeight / 2 + 4}" text-anchor="start" fill="#666" font-size="10">${escapeXml(formatValueLabel(item.value))}</text>`
    );
  }

  // Axis line
  parts.push(
    `<line x1="${BAR_MARGIN.left}" y1="${BAR_MARGIN.top}" x2="${BAR_MARGIN.left}" y2="${BAR_MARGIN.top + chartH}" stroke="#999"/>`
  );

  parts.push("</svg>");
  return parts.join("\n");
}
