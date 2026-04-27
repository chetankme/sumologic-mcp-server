import { z } from "zod";
import { writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SumoClient } from "../client/sumo-client.js";
import { ConfigManager } from "../config/config-manager.js";
import { MetricsQueryResponse } from "../types/metrics.js";
import { generateLineChartSvg } from "../charts/svg-chart.js";
import { metricsResponseToChartData } from "../charts/metrics-chart-adapter.js";

function writeSvgToTempFile(svg: string, prefix: string): string {
  const filename = `${prefix}-${Date.now()}.svg`;
  const filepath = join(tmpdir(), filename);
  writeFileSync(filepath, svg, "utf-8");
  return filepath;
}

const metricsQueryRowSchema = z.object({
  rowId: z.string().describe("Unique identifier for this query row (e.g. 'A', 'B')"),
  query: z.string().describe("Sumo Logic metrics query string"),
});

/**
 * Parse a relative time string like "-15m", "-1h", "-7d" into milliseconds offset.
 * Returns a negative number representing the offset from now.
 */
function parseRelativeTime(rel: string): number {
  const match = rel.match(/^-(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid relative time format: "${rel}". Use e.g. "-15m", "-1h", "-7d".`);
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return -(value * multipliers[unit]);
}

/**
 * Resolve a time parameter to epoch millis.
 * Accepts epoch millis (number) or a relative time string (e.g. "-15m").
 */
function resolveTimeToEpochMillis(time: string | number | undefined, defaultOffsetMs?: number): number {
  if (time === undefined) {
    if (defaultOffsetMs !== undefined) {
      return Date.now() + defaultOffsetMs;
    }
    return Date.now();
  }
  if (typeof time === "number") return time;
  // relative time string
  return Date.now() + parseRelativeTime(time);
}

function computeSeriesStats(datapoints: { timestamp: number[]; value: number[] }): {
  min: number; max: number; avg: number; latest: number;
} | null {
  const vals = datapoints.value;
  if (vals.length === 0) return null;
  let min = vals[0], max = vals[0], sum = 0;
  for (const v of vals) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { min, max, avg: sum / vals.length, latest: vals[vals.length - 1] };
}

type SeriesResult = MetricsQueryResponse["response"][0]["results"][0];

const KNOWN_GROUPING_KEYS = ["Cluster", "_sourceCategory", "Role", "Deployment", "environment", "service", "namespace"];
const KNOWN_IDENTITY_KEYS = ["_sourceHost", "Name", "InstanceId", "host"];

function selectGroupingDimension(results: SeriesResult[]): string | null {
  if (results.length === 0) return null;
  const dimKeys = new Set<string>();
  for (const s of results) {
    for (const d of s.metric.dimensions) dimKeys.add(d.key);
  }

  const uniqueCounts = new Map<string, number>();
  for (const key of dimKeys) {
    const vals = new Set<string>();
    for (const s of results) {
      const dim = s.metric.dimensions.find(d => d.key === key);
      if (dim) vals.add(dim.value);
    }
    const count = vals.size;
    // Filter out per-instance (unique per series) and single-value (same everywhere) dimensions
    if (count > 1 && count < results.length) {
      uniqueCounts.set(key, count);
    }
  }

  if (uniqueCounts.size === 0) return null;

  // Prefer well-known grouping keys
  for (const known of KNOWN_GROUPING_KEYS) {
    if (uniqueCounts.has(known)) return known;
  }

  // Pick dimension with fewest unique values (best grouping)
  let best: string | null = null;
  let bestCount = Infinity;
  for (const [key, count] of uniqueCounts) {
    if (count < bestCount) {
      bestCount = count;
      best = key;
    }
  }
  return best;
}

function findIdentifyingDimension(results: SeriesResult[]): string | null {
  if (results.length === 0) return null;
  const dimKeys = new Set<string>();
  for (const s of results) {
    for (const d of s.metric.dimensions) dimKeys.add(d.key);
  }

  // Prefer well-known identity keys
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

  // Pick dimension with most unique values
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
  // Fallback: first 3 dimensions
  return series.metric.dimensions.slice(0, 3).map(d => `${d.key}=${d.value}`).join(", ");
}

function r1(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function formatQueryRowDetailed(qr: MetricsQueryResponse["response"][0]): string {
  const parts: string[] = [];
  parts.push(`Row ${qr.rowId}: ${qr.results.length} time series`);
  for (const ts of qr.results) {
    const dims = ts.metric.dimensions.map(d => `${d.key}=${d.value}`).join(", ");
    const dpCount = ts.datapoints.timestamp.length;
    if (dpCount > 0) {
      const firstTs = ts.datapoints.timestamp[0];
      const lastTs = ts.datapoints.timestamp[dpCount - 1];
      const stats = computeSeriesStats(ts.datapoints);
      const statsStr = stats
        ? ` | avg=${r1(stats.avg)} min=${r1(stats.min)} max=${r1(stats.max)} latest=${r1(stats.latest)}`
        : "";
      parts.push(
        `  [${dims}] ${dpCount} pts (${new Date(firstTs).toISOString()} to ${new Date(lastTs).toISOString()})${statsStr}`
      );
    } else {
      parts.push(`  [${dims}] no datapoints`);
    }
  }
  return parts.join("\n");
}

function formatQueryRowCompact(qr: MetricsQueryResponse["response"][0]): string {
  const parts: string[] = [];
  const results = qr.results;
  const totalSeries = results.length;

  // Collect latest values and stats per series
  const seriesWithStats: Array<{ series: SeriesResult; latest: number; stats: NonNullable<ReturnType<typeof computeSeriesStats>> }> = [];
  let emptyCount = 0;
  let globalMinTs = Infinity, globalMaxTs = -Infinity;

  for (const s of results) {
    const dpLen = s.datapoints.timestamp.length;
    if (dpLen === 0) { emptyCount++; continue; }
    if (s.datapoints.timestamp[0] < globalMinTs) globalMinTs = s.datapoints.timestamp[0];
    if (s.datapoints.timestamp[dpLen - 1] > globalMaxTs) globalMaxTs = s.datapoints.timestamp[dpLen - 1];
    const stats = computeSeriesStats(s.datapoints);
    if (stats) seriesWithStats.push({ series: s, latest: stats.latest, stats });
  }

  if (seriesWithStats.length === 0) {
    parts.push(`Row ${qr.rowId}: ${totalSeries} time series — no datapoints returned`);
    return parts.join("\n");
  }

  // Header
  const emptyNote = emptyCount > 0 ? `, ${emptyCount} empty` : "";
  const timeRange = `${new Date(globalMinTs).toISOString()} to ${new Date(globalMaxTs).toISOString()}`;
  parts.push(`Row ${qr.rowId}: ${totalSeries} time series${emptyNote} | ${timeRange}`);

  // Overall stats from latest values
  const latestValues = seriesWithStats.map(s => s.latest).sort((a, b) => a - b);
  const overallAvg = latestValues.reduce((a, b) => a + b, 0) / latestValues.length;
  const overallMin = latestValues[0];
  const overallMax = latestValues[latestValues.length - 1];
  const p50 = percentile(latestValues, 50);
  const p95 = percentile(latestValues, 95);
  parts.push(`\nOverall (latest values): avg=${r1(overallAvg)} min=${r1(overallMin)} max=${r1(overallMax)} p50=${r1(p50)} p95=${r1(p95)}`);

  // Grouping
  const groupingKey = selectGroupingDimension(results);
  if (groupingKey) {
    const groups = new Map<string, number[]>();
    for (const s of seriesWithStats) {
      const dim = s.series.metric.dimensions.find(d => d.key === groupingKey);
      const val = dim?.value ?? "(unknown)";
      if (!groups.has(val)) groups.set(val, []);
      groups.get(val)!.push(s.latest);
    }

    const groupStats = [...groups.entries()].map(([name, vals]) => {
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      return { name, count: vals.length, avg, min, max };
    }).sort((a, b) => b.avg - a.avg);

    parts.push(`\nBy ${groupingKey} (${groupStats.length} groups, sorted by avg desc):`);
    for (const g of groupStats) {
      parts.push(`  ${g.name}: ${g.count} series | avg=${r1(g.avg)} min=${r1(g.min)} max=${r1(g.max)}`);
    }
  }

  // Top/Bottom outliers
  const identifyingKey = findIdentifyingDimension(results);
  const sortedByLatest = [...seriesWithStats].sort((a, b) => b.latest - a.latest);
  const topN = Math.min(10, sortedByLatest.length);
  parts.push(`\nTop ${topN} by latest value:`);
  for (let i = 0; i < topN; i++) {
    const s = sortedByLatest[i];
    parts.push(`  ${getSeriesLabel(s.series, identifyingKey)}: ${r1(s.latest)}`);
  }

  if (sortedByLatest.length > topN) {
    const bottomN = Math.min(5, sortedByLatest.length - topN);
    parts.push(`\nBottom ${bottomN} by latest value:`);
    for (let i = sortedByLatest.length - bottomN; i < sortedByLatest.length; i++) {
      const s = sortedByLatest[i];
      parts.push(`  ${getSeriesLabel(s.series, identifyingKey)}: ${r1(s.latest)}`);
    }
  }

  return parts.join("\n");
}

function formatMetricsResponse(resp: MetricsQueryResponse): string {
  const parts: string[] = [];

  if (resp.error || resp.errorMessage) {
    parts.push(`Error: ${resp.error ?? ""} ${resp.errorMessage ?? ""}`.trim());
  }

  if (resp.response) {
    for (const qr of resp.response) {
      if (qr.results.length <= 10) {
        parts.push(formatQueryRowDetailed(qr));
      } else {
        parts.push(formatQueryRowCompact(qr));
      }
    }
  }

  return parts.join("\n\n") || "No results.";
}

export function registerMetricsTools(
  server: McpServer,
  client: SumoClient,
  configManager: ConfigManager
): void {
  server.tool(
    "sumo_run_metrics_query",
    "Execute a Sumo Logic metrics query and return results",
    {
      account: z.string().describe("Name of the Sumo Logic account to use"),
      queries: z
        .array(metricsQueryRowSchema)
        .describe("Array of metrics query rows"),
      startTime: z.union([z.number(), z.string()]).optional()
        .describe("Start time as epoch millis (number) or relative string (e.g. '-15m', '-1h', '-7d'). Defaults to -15m."),
      endTime: z.union([z.number(), z.string()]).optional()
        .describe("End time as epoch millis (number) or relative string. Defaults to now."),
      requestedDataPoints: z.number().optional()
        .describe("Requested number of data points (default: 50)"),
      maxDataPoints: z.number().optional()
        .describe("Maximum data points per time series (default: 100)"),
      maxTotalDataPoints: z.number().optional()
        .describe("Maximum total data points across all time series (default: 5000)"),
      desiredQuantizationInSecs: z.number().optional()
        .describe("Desired quantization in seconds (default: 60)"),
      renderChart: z.boolean().optional()
        .describe("Generate SVG line chart visualization (default: false)"),
    },
    async ({ account, queries, startTime, endTime, requestedDataPoints, maxDataPoints, maxTotalDataPoints, desiredQuantizationInSecs, renderChart }) => {
      try {
        const body: Record<string, unknown> = {
          query: queries,
          startTime: resolveTimeToEpochMillis(startTime, -15 * 60000),
          endTime: resolveTimeToEpochMillis(endTime),
        };
        body.requestedDataPoints = requestedDataPoints ?? 50;
        body.maxDataPoints = maxDataPoints ?? 100;
        body.maxTotalDataPoints = maxTotalDataPoints ?? 5000;
        body.desiredQuantizationInSecs = desiredQuantizationInSecs ?? 60;

        const resp = await client.post<MetricsQueryResponse>(
          "/v1/metrics/results",
          body,
          account
        );

        let text = formatMetricsResponse(resp);

        if (renderChart && resp.response) {
          const chartPaths: string[] = [];
          for (const qr of resp.response) {
            const chartData = metricsResponseToChartData(qr);
            if (chartData) {
              const svg = generateLineChartSvg(chartData);
              if (svg) {
                chartPaths.push(writeSvgToTempFile(svg, "sumo-metrics-chart"));
              }
            }
          }
          if (chartPaths.length > 0) {
            text += `\n\nCharts saved to:\n${chartPaths.join("\n")}`;
          }
        }

        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Multi-account: metrics query across all accounts in parallel
  server.tool(
    "sumo_run_metrics_query_all",
    "Execute a Sumo Logic metrics query across ALL configured accounts in parallel and return aggregated results",
    {
      queries: z
        .array(metricsQueryRowSchema)
        .describe("Array of metrics query rows"),
      startTime: z.union([z.number(), z.string()]).optional()
        .describe("Start time as epoch millis (number) or relative string (e.g. '-15m', '-1h', '-7d'). Defaults to -15m."),
      endTime: z.union([z.number(), z.string()]).optional()
        .describe("End time as epoch millis (number) or relative string. Defaults to now."),
      requestedDataPoints: z.number().optional()
        .describe("Requested number of data points (default: 50)"),
      maxDataPoints: z.number().optional()
        .describe("Maximum data points per time series (default: 100)"),
      maxTotalDataPoints: z.number().optional()
        .describe("Maximum total data points across all time series (default: 5000)"),
      desiredQuantizationInSecs: z.number().optional()
        .describe("Desired quantization in seconds (default: 60)"),
      renderChart: z.boolean().optional()
        .describe("Generate SVG line chart visualization (default: false)"),
    },
    async ({ queries, startTime, endTime, requestedDataPoints, maxDataPoints, maxTotalDataPoints, desiredQuantizationInSecs, renderChart }) => {
      try {
        const accountNames = client.getAllAccountNames();
        if (accountNames.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No accounts configured.",
              },
            ],
            isError: true,
          };
        }

        const body: Record<string, unknown> = {
          query: queries,
          startTime: resolveTimeToEpochMillis(startTime, -15 * 60000),
          endTime: resolveTimeToEpochMillis(endTime),
        };
        body.requestedDataPoints = requestedDataPoints ?? 50;
        body.maxDataPoints = maxDataPoints ?? 100;
        body.maxTotalDataPoints = maxTotalDataPoints ?? 5000;
        body.desiredQuantizationInSecs = desiredQuantizationInSecs ?? 60;

        const accounts = configManager.listAccounts();
        const accountDeployments = new Map(
          accounts.map(a => [a.name, a.deployment])
        );

        const results = await Promise.allSettled(
          accountNames.map(name =>
            client.post<MetricsQueryResponse>(
              "/v1/metrics/results",
              body,
              name
            )
          )
        );

        const sections: string[] = [];
        const chartPaths: string[] = [];
        for (let i = 0; i < accountNames.length; i++) {
          const name = accountNames[i];
          const deployment = accountDeployments.get(name) ?? "unknown";
          const result = results[i];

          if (result.status === "fulfilled") {
            sections.push(
              `=== Account: ${name} (${deployment}) ===\n${formatMetricsResponse(result.value)}`
            );
            if (renderChart && result.value.response) {
              for (const qr of result.value.response) {
                const chartData = metricsResponseToChartData(qr);
                if (chartData) {
                  chartData.title = `${name} (${deployment}) — ${chartData.title}`;
                  const svg = generateLineChartSvg(chartData);
                  if (svg) {
                    chartPaths.push(writeSvgToTempFile(svg, `sumo-metrics-chart-${name}`));
                  }
                }
              }
            }
          } else {
            const errMsg = result.reason instanceof Error
              ? result.reason.message
              : String(result.reason);
            sections.push(`=== Account: ${name} (${deployment}) ===\nError: ${errMsg}`);
          }
        }

        let text = sections.join("\n\n");
        if (chartPaths.length > 0) {
          text += `\n\nCharts saved to:\n${chartPaths.join("\n")}`;
        }

        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Metrics query all error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
