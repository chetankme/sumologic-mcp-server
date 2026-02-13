import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SumoClient } from "../client/sumo-client.js";
import { SavedLogSearch, SavedLogSearchListResponse } from "../types/search.js";

// Zod schema for the time range parameter used by create/update
const timeRangeSchema = z.object({
  type: z.literal("BeginBoundedTimeRange"),
  from: z.object({
    type: z.enum([
      "RelativeTimeRangeBoundary",
      "EpochTimeRangeBoundary",
      "LiteralTimeRangeBoundary",
    ]),
    relativeTime: z.string().optional(),
    epochMillis: z.number().optional(),
    rangeName: z.string().optional(),
  }),
  to: z
    .object({
      type: z.enum(["RelativeTimeRangeBoundary", "EpochTimeRangeBoundary"]),
      relativeTime: z.string().optional(),
      epochMillis: z.number().optional(),
    })
    .optional(),
});

function formatLogSearch(s: SavedLogSearch): string {
  return [
    `ID: ${s.id ?? "N/A"}`,
    `Name: ${s.name}`,
    s.description ? `Description: ${s.description}` : null,
    `Query: ${s.queryString}`,
    `Parsing Mode: ${s.parsingMode ?? "AutoParse"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function registerLogSearchTools(
  server: McpServer,
  client: SumoClient
): void {
  server.tool(
    "sumo_list_log_searches",
    "List all saved log searches",
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

        const resp = await client.get<SavedLogSearchListResponse>(
          "/v1/logSearches",
          params
        );

        if (!resp.data || resp.data.length === 0) {
          return {
            content: [
              { type: "text" as const, text: "No saved log searches found." },
            ],
          };
        }

        const items = resp.data.map(formatLogSearch).join("\n\n---\n\n");
        const nextToken = resp.next ? `\nNext page token: ${resp.next}` : "";

        return {
          content: [
            {
              type: "text" as const,
              text: `${resp.data.length} saved log searches:\n\n${items}${nextToken}`,
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
    "sumo_create_log_search",
    "Create a new saved log search",
    {
      name: z.string().describe("Name for the saved search"),
      description: z.string().optional().describe("Description"),
      queryString: z.string().describe("The Sumo Logic query"),
      timeRange: timeRangeSchema.describe("Time range configuration"),
      parsingMode: z
        .enum(["Manual", "AutoParse"])
        .optional()
        .describe("Parsing mode (default: AutoParse)"),
    },
    async ({ name, description, queryString, timeRange, parsingMode }) => {
      try {
        const body: Record<string, unknown> = {
          name,
          queryString,
          timeRange,
          parsingMode: parsingMode ?? "AutoParse",
        };
        if (description) body.description = description;

        const result = await client.post<SavedLogSearch>(
          "/v1/logSearches",
          body
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `Saved log search created:\n${formatLogSearch(result)}`,
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
    "sumo_get_log_search",
    "Get a saved log search by ID",
    {
      id: z.string().describe("Saved log search ID"),
    },
    async ({ id }) => {
      try {
        const result = await client.get<SavedLogSearch>(
          `/v1/logSearches/${id}`
        );

        return {
          content: [
            {
              type: "text" as const,
              text: formatLogSearch(result),
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
    "sumo_update_log_search",
    "Update a saved log search",
    {
      id: z.string().describe("Saved log search ID to update"),
      name: z.string().describe("Updated name"),
      description: z.string().optional().describe("Updated description"),
      queryString: z.string().describe("Updated query string"),
      timeRange: timeRangeSchema.describe("Updated time range"),
      parsingMode: z
        .enum(["Manual", "AutoParse"])
        .optional()
        .describe("Updated parsing mode"),
    },
    async ({ id, name, description, queryString, timeRange, parsingMode }) => {
      try {
        const body: Record<string, unknown> = {
          name,
          queryString,
          timeRange,
        };
        if (description !== undefined) body.description = description;
        if (parsingMode) body.parsingMode = parsingMode;

        const result = await client.put<SavedLogSearch>(
          `/v1/logSearches/${id}`,
          body
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `Saved log search updated:\n${formatLogSearch(result)}`,
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
    "sumo_delete_log_search",
    "Delete a saved log search",
    {
      id: z.string().describe("Saved log search ID to delete"),
    },
    async ({ id }) => {
      try {
        await client.delete(`/v1/logSearches/${id}`);

        return {
          content: [
            {
              type: "text" as const,
              text: `Saved log search ${id} deleted.`,
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
