import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SumoClient } from "../client/sumo-client.js";
import { ConfigManager } from "../config/config-manager.js";
import { MetricsQueryResponse } from "../types/metrics.js";

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

function formatMetricsResponse(resp: MetricsQueryResponse): string {
  const parts: string[] = [];

  if (resp.error || resp.errorMessage) {
    parts.push(`Error: ${resp.error ?? ""} ${resp.errorMessage ?? ""}`.trim());
  }

  if (resp.response) {
    for (const qr of resp.response) {
      parts.push(`Row ${qr.rowId}: ${qr.results.length} time series`);
      for (const ts of qr.results) {
        const dims = ts.metric.dimensions
          .map((d) => `${d.key}=${d.value}`)
          .join(", ");
        const dpCount = ts.datapoints.timestamp.length;
        if (dpCount > 0) {
          const firstTs = ts.datapoints.timestamp[0];
          const lastTs = ts.datapoints.timestamp[dpCount - 1];
          parts.push(
            `  [${dims}] ${dpCount} datapoints (${new Date(firstTs).toISOString()} to ${new Date(lastTs).toISOString()})`
          );
          // Show first few and last few datapoints
          const show = Math.min(5, dpCount);
          for (let i = 0; i < show; i++) {
            parts.push(
              `    ${new Date(ts.datapoints.timestamp[i]).toISOString()}: ${ts.datapoints.value[i]}`
            );
          }
          if (dpCount > 10) {
            parts.push(`    ... (${dpCount - 10} more)`);
            for (let i = dpCount - 5; i < dpCount; i++) {
              parts.push(
                `    ${new Date(ts.datapoints.timestamp[i]).toISOString()}: ${ts.datapoints.value[i]}`
              );
            }
          } else if (dpCount > show) {
            for (let i = show; i < dpCount; i++) {
              parts.push(
                `    ${new Date(ts.datapoints.timestamp[i]).toISOString()}: ${ts.datapoints.value[i]}`
              );
            }
          }
        } else {
          parts.push(`  [${dims}] no datapoints`);
        }
      }
    }
  }

  return parts.join("\n") || "No results.";
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
      queries: z
        .array(metricsQueryRowSchema)
        .describe("Array of metrics query rows"),
      startTime: z.union([z.number(), z.string()]).optional()
        .describe("Start time as epoch millis (number) or relative string (e.g. '-15m', '-1h', '-7d'). Defaults to -15m."),
      endTime: z.union([z.number(), z.string()]).optional()
        .describe("End time as epoch millis (number) or relative string. Defaults to now."),
      requestedDataPoints: z.number().optional()
        .describe("Requested number of data points (default: 600)"),
      maxDataPoints: z.number().optional()
        .describe("Maximum data points per time series (default: 800)"),
      maxTotalDataPoints: z.number().optional()
        .describe("Maximum total data points across all time series (default: 50000)"),
      desiredQuantizationInSecs: z.number().optional()
        .describe("Desired quantization in seconds (default: 60)"),
    },
    async ({ queries, startTime, endTime, requestedDataPoints, maxDataPoints, maxTotalDataPoints, desiredQuantizationInSecs }) => {
      try {
        const body: Record<string, unknown> = {
          query: queries,
          startTime: resolveTimeToEpochMillis(startTime, -15 * 60000),
          endTime: resolveTimeToEpochMillis(endTime),
        };
        if (requestedDataPoints !== undefined) body.requestedDataPoints = requestedDataPoints;
        if (maxDataPoints !== undefined) body.maxDataPoints = maxDataPoints;
        if (maxTotalDataPoints !== undefined) body.maxTotalDataPoints = maxTotalDataPoints;
        body.desiredQuantizationInSecs = desiredQuantizationInSecs ?? 60;

        const resp = await client.post<MetricsQueryResponse>(
          "/v1/metrics/results",
          body
        );

        return {
          content: [
            {
              type: "text" as const,
              text: formatMetricsResponse(resp),
            },
          ],
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
        .describe("Requested number of data points (default: 600)"),
      maxDataPoints: z.number().optional()
        .describe("Maximum data points per time series (default: 800)"),
      maxTotalDataPoints: z.number().optional()
        .describe("Maximum total data points across all time series (default: 50000)"),
      desiredQuantizationInSecs: z.number().optional()
        .describe("Desired quantization in seconds (default: 60)"),
    },
    async ({ queries, startTime, endTime, requestedDataPoints, maxDataPoints, maxTotalDataPoints, desiredQuantizationInSecs }) => {
      try {
        const accountNames = client.getAllAccountNames();
        if (accountNames.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No accounts configured. Use sumo_add_account to add one.",
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
        if (requestedDataPoints !== undefined) body.requestedDataPoints = requestedDataPoints;
        if (maxDataPoints !== undefined) body.maxDataPoints = maxDataPoints;
        if (maxTotalDataPoints !== undefined) body.maxTotalDataPoints = maxTotalDataPoints;
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
        for (let i = 0; i < accountNames.length; i++) {
          const name = accountNames[i];
          const deployment = accountDeployments.get(name) ?? "unknown";
          const result = results[i];

          if (result.status === "fulfilled") {
            sections.push(
              `=== Account: ${name} (${deployment}) ===\n${formatMetricsResponse(result.value)}`
            );
          } else {
            const errMsg = result.reason instanceof Error
              ? result.reason.message
              : String(result.reason);
            sections.push(`=== Account: ${name} (${deployment}) ===\nError: ${errMsg}`);
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: sections.join("\n\n"),
            },
          ],
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
