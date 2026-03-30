import { ChartData, ChartSeries, BarChartData } from "../types/chart.js";
import { SearchRecordsResponse } from "../types/search.js";
import { COLOR_PALETTE } from "./svg-chart.js";

const NUMERIC_FIELD_TYPES = new Set(["int", "long", "double", "float"]);

/**
 * Detect whether records contain a _timeslice field and produce a line chart,
 * or detect categorical grouping and produce a bar chart.
 * Returns { type, data } or null if the data isn't chartable.
 */
export function searchRecordsToChart(
  resp: SearchRecordsResponse,
  maxItems = 20
): { type: "line"; data: ChartData } | { type: "bar"; data: BarChartData } | null {
  if (!resp.records || resp.records.length === 0) return null;
  if (!resp.fields || resp.fields.length < 2) return null;

  const hasTimeslice = resp.fields.some(f => f.name === "_timeslice");

  if (hasTimeslice) {
    return buildTimesliceChart(resp, maxItems);
  }

  return buildCategoricalChart(resp, maxItems);
}

/**
 * Build a line chart from timeslice-based aggregate results.
 * Each numeric column becomes a series; _timeslice is the x-axis.
 */
function buildTimesliceChart(
  resp: SearchRecordsResponse,
  maxSeries: number
): { type: "line"; data: ChartData } | null {
  const numericFields = resp.fields.filter(
    f => f.name !== "_timeslice" && NUMERIC_FIELD_TYPES.has(f.fieldType)
  );

  if (numericFields.length === 0) return null;

  // Sort records by timeslice
  const sorted = [...resp.records].sort(
    (a, b) => Number(a.map["_timeslice"] ?? 0) - Number(b.map["_timeslice"] ?? 0)
  );

  // Check if there's a grouping field (string field that isn't _timeslice)
  const groupField = resp.fields.find(
    f => f.name !== "_timeslice" && !NUMERIC_FIELD_TYPES.has(f.fieldType)
  );

  if (groupField && numericFields.length === 1) {
    // Grouped timeslice: e.g., "| timeslice 1m | count by _timeslice, _sourceCategory"
    return buildGroupedTimesliceChart(sorted, groupField.name, numericFields[0].name, maxSeries);
  }

  // Simple timeslice: each numeric field is a series
  const fieldsToChart = numericFields.slice(0, maxSeries);
  const series: ChartSeries[] = fieldsToChart.map((f, i) => ({
    label: f.name,
    color: COLOR_PALETTE[i % COLOR_PALETTE.length],
    timestamps: sorted.map(r => Number(r.map["_timeslice"])),
    values: sorted.map(r => Number(r.map[f.name] ?? 0)),
  }));

  return {
    type: "line",
    data: {
      title: `Timeslice: ${fieldsToChart.map(f => f.name).join(", ")}`,
      series,
      width: 800,
      height: 400,
    },
  };
}

/**
 * Build a line chart for grouped timeslice data.
 * Each unique value of the group field becomes a separate series.
 */
function buildGroupedTimesliceChart(
  sortedRecords: SearchRecordsResponse["records"],
  groupField: string,
  valueField: string,
  maxSeries: number
): { type: "line"; data: ChartData } | null {
  // Group by the grouping field
  const groups = new Map<string, { timestamps: number[]; values: number[] }>();
  for (const r of sortedRecords) {
    const groupVal = r.map[groupField] ?? "(unknown)";
    if (!groups.has(groupVal)) {
      groups.set(groupVal, { timestamps: [], values: [] });
    }
    const g = groups.get(groupVal)!;
    g.timestamps.push(Number(r.map["_timeslice"]));
    g.values.push(Number(r.map[valueField] ?? 0));
  }

  if (groups.size === 0) return null;

  // Sort groups by total value descending, take top N
  const sortedGroups = [...groups.entries()]
    .map(([name, data]) => ({
      name,
      data,
      total: data.values.reduce((a, b) => a + b, 0),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, maxSeries);

  const series: ChartSeries[] = sortedGroups.map((g, i) => ({
    label: g.name,
    color: COLOR_PALETTE[i % COLOR_PALETTE.length],
    timestamps: g.data.timestamps,
    values: g.data.values,
  }));

  const suffix = groups.size > maxSeries ? ` (top ${maxSeries} of ${groups.size})` : "";

  return {
    type: "line",
    data: {
      title: `${valueField} by ${groupField}${suffix}`,
      series,
      width: 800,
      height: 400,
    },
  };
}

/**
 * Build a bar chart from categorical aggregate results (e.g., count by source).
 */
function buildCategoricalChart(
  resp: SearchRecordsResponse,
  maxItems: number
): { type: "bar"; data: BarChartData } | null {
  // Find the first numeric field (the value) and the first string field (the category)
  const numericField = resp.fields.find(f => NUMERIC_FIELD_TYPES.has(f.fieldType));
  const categoryField = resp.fields.find(f => !NUMERIC_FIELD_TYPES.has(f.fieldType));

  if (!numericField || !categoryField) return null;

  // Sort by numeric value descending
  const sorted = [...resp.records]
    .map(r => ({
      label: r.map[categoryField.name] ?? "(unknown)",
      value: Number(r.map[numericField.name] ?? 0),
    }))
    .filter(d => !isNaN(d.value))
    .sort((a, b) => b.value - a.value)
    .slice(0, maxItems);

  if (sorted.length === 0) return null;

  const items = sorted.map((d, i) => ({
    label: d.label,
    value: d.value,
    color: COLOR_PALETTE[i % COLOR_PALETTE.length],
  }));

  const suffix = resp.records.length > maxItems ? ` (top ${maxItems} of ${resp.records.length})` : "";

  // Dynamic height based on number of bars
  const height = Math.max(300, Math.min(600, 60 + sorted.length * 28));

  return {
    type: "bar",
    data: {
      title: `${numericField.name} by ${categoryField.name}${suffix}`,
      items,
      valueLabel: numericField.name,
      width: 800,
      height,
    },
  };
}
