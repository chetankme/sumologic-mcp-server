import { ChartData, ChartSeries } from "../types/chart.js";
import { MetricsQueryResponse } from "../types/metrics.js";
import { COLOR_PALETTE } from "./svg-chart.js";

type SeriesResult = MetricsQueryResponse["response"][0]["results"][0];

const KNOWN_IDENTITY_KEYS = ["_sourceHost", "Name", "InstanceId", "host"];

function findIdentifyingDimension(results: SeriesResult[]): string | null {
  if (results.length === 0) return null;
  const dimKeys = new Set<string>();
  for (const s of results) {
    for (const d of s.metric.dimensions) dimKeys.add(d.key);
  }

  for (const known of KNOWN_IDENTITY_KEYS) {
    if (dimKeys.has(known)) {
      const vals = new Set<string>();
      for (const s of results) {
        const dim = s.metric.dimensions.find(d => d.key === known);
        if (dim) vals.add(dim.value);
      }
      if (vals.size > 1) return known;
    }
  }

  let best: string | null = null;
  let bestCount = 0;
  for (const key of dimKeys) {
    const vals = new Set<string>();
    for (const s of results) {
      const dim = s.metric.dimensions.find(d => d.key === key);
      if (dim) vals.add(dim.value);
    }
    if (vals.size > bestCount) {
      bestCount = vals.size;
      best = key;
    }
  }
  return best;
}

function getSeriesLabel(series: SeriesResult, identifyingKey: string | null): string {
  if (identifyingKey) {
    const dim = series.metric.dimensions.find(d => d.key === identifyingKey);
    if (dim) return dim.value;
  }
  return series.metric.dimensions.slice(0, 3).map(d => `${d.key}=${d.value}`).join(", ");
}

/**
 * Transform a single metrics query row into ChartData suitable for SVG rendering.
 * Caps at maxSeries (sorted by latest value descending). Returns null if no renderable data.
 */
export function metricsResponseToChartData(
  queryRow: MetricsQueryResponse["response"][0],
  maxSeries = 10
): ChartData | null {
  // Filter to series that have datapoints
  const withData = queryRow.results.filter(r => r.datapoints.timestamp.length > 0);
  if (withData.length === 0) return null;

  // Sort by latest value descending, take top N
  const sorted = [...withData].sort((a, b) => {
    const aLast = a.datapoints.value[a.datapoints.value.length - 1] ?? 0;
    const bLast = b.datapoints.value[b.datapoints.value.length - 1] ?? 0;
    return bLast - aLast;
  });
  const selected = sorted.slice(0, maxSeries);

  const identifyingKey = findIdentifyingDimension(selected);

  const series: ChartSeries[] = selected.map((s, i) => ({
    label: getSeriesLabel(s, identifyingKey),
    color: COLOR_PALETTE[i % COLOR_PALETTE.length],
    timestamps: s.datapoints.timestamp,
    values: s.datapoints.value,
  }));

  const totalSeries = queryRow.results.length;
  const suffix = totalSeries > maxSeries ? ` (top ${maxSeries} of ${totalSeries})` : "";

  return {
    title: `Row ${queryRow.rowId}: ${totalSeries} series${suffix}`,
    series,
    width: 800,
    height: 400,
  };
}
