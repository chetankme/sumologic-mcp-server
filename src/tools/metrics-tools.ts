import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SumoClient } from "../client/sumo-client.js";
import { ConfigManager } from "../config/config-manager.js";
import { MetricsQueryResponse } from "../types/metrics.js";

const metricsQueryRowSchema = z.object({
  rowId: z.string().describe("Unique identifier for this query row (e.g. 'A', 'B')"),
  query: z.string().describe("Sumo Logic metrics query string"),
});

const metricsTimeRangeSchema = z.object({
  type: z.literal("BeginBoundedTimeRange"),
  from: z.object({
    type: z.enum(["RelativeTimeRangeBoundary", "EpochTimeRangeBoundary"]),
    relativeTime: z.string().optional(),
    epochMillis: z.number().optional(),
  }),
  to: z
    .object({
      type: z.enum(["RelativeTimeRangeBoundary", "EpochTimeRangeBoundary"]),
      relativeTime: z.string().optional(),
      epochMillis: z.number().optional(),
    })
    .optional(),
});

function formatMetricsResponse(resp: MetricsQueryResponse): string {
  const parts: string[] = [];

  if (resp.queryResult) {
    for (const qr of resp.queryResult) {
      parts.push(`Row ${qr.rowId}: ${qr.results.length} time series`);
      for (const ts of qr.results) {
        const dims = Object.entries(ts.dimensions)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ");
        const dpCount = ts.datapoints.length;
        if (dpCount > 0) {
          const first = ts.datapoints[0];
          const last = ts.datapoints[dpCount - 1];
          parts.push(
            `  [${dims}] ${dpCount} datapoints (${new Date(first.timestamp).toISOString()} to ${new Date(last.timestamp).toISOString()})`
          );
          // Show first few and last few datapoints
          const show = Math.min(5, dpCount);
          for (let i = 0; i < show; i++) {
            const dp = ts.datapoints[i];
            parts.push(
              `    ${new Date(dp.timestamp).toISOString()}: ${dp.value}`
            );
          }
          if (dpCount > 10) {
            parts.push(`    ... (${dpCount - 10} more)`);
            for (let i = dpCount - 5; i < dpCount; i++) {
              const dp = ts.datapoints[i];
              parts.push(
                `    ${new Date(dp.timestamp).toISOString()}: ${dp.value}`
              );
            }
          } else if (dpCount > show) {
            for (let i = show; i < dpCount; i++) {
              const dp = ts.datapoints[i];
              parts.push(
                `    ${new Date(dp.timestamp).toISOString()}: ${dp.value}`
              );
            }
          }
        } else {
          parts.push(`  [${dims}] no datapoints`);
        }
      }
    }
  }

  if (resp.errors && resp.errors.length > 0) {
    parts.push("\nErrors:");
    for (const e of resp.errors) {
      for (const err of e.errors) {
        parts.push(`  Row ${e.rowId}: [${err.code}] ${err.message}`);
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
      timeRange: metricsTimeRangeSchema.describe("Time range for the query"),
    },
    async ({ queries, timeRange }) => {
      try {
        const resp = await client.post<MetricsQueryResponse>(
          "/v1/metrics/results",
          { queries, timeRange }
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
      timeRange: metricsTimeRangeSchema.describe("Time range for the query"),
    },
    async ({ queries, timeRange }) => {
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

        const accounts = configManager.listAccounts();
        const accountDeployments = new Map(
          accounts.map(a => [a.name, a.deployment])
        );

        const results = await Promise.allSettled(
          accountNames.map(name =>
            client.post<MetricsQueryResponse>(
              "/v1/metrics/results",
              { queries, timeRange },
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
