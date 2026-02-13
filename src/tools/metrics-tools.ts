import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SumoClient } from "../client/sumo-client.js";
import {
  MetricsQueryResponse,
  SavedMetricsSearch,
  SavedMetricsSearchListResponse,
} from "../types/metrics.js";

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

function formatSavedMetricsSearch(s: SavedMetricsSearch): string {
  const queries = s.metricsQueries
    .map((q) => `  ${q.rowId}: ${q.query}`)
    .join("\n");
  return [
    `ID: ${s.id ?? "N/A"}`,
    `Title: ${s.title}`,
    `Description: ${s.description}`,
    `Queries:\n${queries}`,
  ].join("\n");
}

export function registerMetricsTools(
  server: McpServer,
  client: SumoClient
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

  server.tool(
    "sumo_list_metrics_searches",
    "List saved metrics searches",
    {
      limit: z
        .number()
        .optional()
        .describe("Max number of results (default: 100)"),
      token: z
        .string()
        .optional()
        .describe("Pagination token from previous response"),
    },
    async ({ limit, token }) => {
      try {
        const params: Record<string, string | number | boolean | undefined> = {
          limit: limit ?? 100,
        };
        if (token) params.token = token;

        const resp = await client.get<SavedMetricsSearchListResponse>(
          "/v1/metricsSearches",
          params
        );

        if (
          !resp.metricsSearches ||
          resp.metricsSearches.length === 0
        ) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No saved metrics searches found.",
              },
            ],
          };
        }

        const items = resp.metricsSearches
          .map(formatSavedMetricsSearch)
          .join("\n\n---\n\n");
        const nextToken = resp.token ? `\nNext page token: ${resp.token}` : "";

        return {
          content: [
            {
              type: "text" as const,
              text: `${resp.metricsSearches.length} saved metrics searches:\n\n${items}${nextToken}`,
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

  server.tool(
    "sumo_get_metrics_search",
    "Get a saved metrics search by ID",
    {
      id: z.string().describe("Saved metrics search ID"),
    },
    async ({ id }) => {
      try {
        const result = await client.get<SavedMetricsSearch>(
          `/v1/metricsSearches/${id}`
        );

        return {
          content: [
            {
              type: "text" as const,
              text: formatSavedMetricsSearch(result),
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

  server.tool(
    "sumo_save_metrics_search",
    "Create a new saved metrics search",
    {
      title: z.string().describe("Title for the saved search"),
      description: z.string().describe("Description"),
      metricsQueries: z
        .array(metricsQueryRowSchema)
        .describe("Metrics query rows"),
      timeRange: metricsTimeRangeSchema.describe("Time range configuration"),
      desiredQuantizationInSecs: z
        .number()
        .optional()
        .describe("Desired quantization in seconds"),
    },
    async ({
      title,
      description,
      metricsQueries,
      timeRange,
      desiredQuantizationInSecs,
    }) => {
      try {
        const body: Record<string, unknown> = {
          title,
          description,
          metricsQueries,
          timeRange,
        };
        if (desiredQuantizationInSecs !== undefined) {
          body.desiredQuantizationInSecs = desiredQuantizationInSecs;
        }

        const result = await client.post<SavedMetricsSearch>(
          "/v1/metricsSearches",
          body
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `Saved metrics search created:\n${formatSavedMetricsSearch(result)}`,
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
}
