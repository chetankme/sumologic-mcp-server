import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SumoClient } from "../client/sumo-client.js";
import { ConfigManager } from "../config/config-manager.js";
import {
  CreateSearchJobResponse,
  SearchJobStatus,
  SearchMessagesResponse,
  SearchRecordsResponse,
} from "../types/search.js";

/** Convert a relative time string (e.g. "-15m", "-1h", "-3h", "-1d") or
 *  an already-absolute ISO 8601 string to an ISO 8601 string.
 *  Relative strings are resolved against Date.now(). */
function resolveTimeToISO(time: string): string {
  const match = time.match(/^-(\d+)([smhd])$/);
  if (!match) return time; // already absolute, pass through
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return new Date(Date.now() - value * multipliers[unit]).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const POLL_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;

const AGGREGATION_PATTERN =
  /\|\s*(?:count|sum|avg|min|max|first|last|total|pct|values|stddev|fillmissing|timeslice|count_frequent|top|topk|bottomk|transpose|outlier|predict|compare)\b/i;

function hasAggregation(query: string): boolean {
  return AGGREGATION_PATTERN.test(query);
}

function addLimitIfNeeded(query: string, limit: number): string {
  if (hasAggregation(query)) return query;
  if (/\|\s*limit\b/i.test(query)) return query;
  return `${query.trimEnd()} | limit ${limit}`;
}

async function pollUntilDone(
  client: SumoClient,
  jobId: string,
  accountName: string
): Promise<SearchJobStatus> {
  const start = Date.now();

  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const status = await client.get<SearchJobStatus>(
      `/v1/search/jobs/${jobId}`,
      undefined,
      accountName
    );

    if (status.state === "DONE GATHERING RESULTS") {
      return status;
    }

    if (status.state === "CANCELLED") {
      throw new Error("Search job was cancelled");
    }

    if (status.state === "FORCE PAUSED") {
      throw new Error(
        "Search job was force paused by Sumo Logic (query too expensive)"
      );
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  // Attempt cleanup on timeout
  try {
    await client.delete(`/v1/search/jobs/${jobId}`, accountName);
  } catch {
    // best-effort cleanup
  }
  throw new Error(
    `Search job timed out after ${POLL_TIMEOUT_MS / 1000}s. The query may be too broad.`
  );
}

function formatMessages(resp: SearchMessagesResponse): string {
  if (!resp.messages || resp.messages.length === 0) {
    return "No messages found.";
  }

  const lines = resp.messages.map((msg, i) => {
    const raw = msg.map["_raw"] || JSON.stringify(msg.map);
    const time = msg.map["_messagetime"] || msg.map["_receipttime"] || "";
    return `[${i + 1}] ${time ? time + " " : ""}${raw}`;
  });

  return `${resp.messages.length} messages:\n${lines.join("\n")}`;
}

function formatRecords(resp: SearchRecordsResponse): string {
  if (!resp.records || resp.records.length === 0) {
    return "No records found.";
  }

  const fieldNames = resp.fields.map((f) => f.name);
  const hasTimeslice = resp.fields.some((f) => f.name === "_timeslice");
  const records = hasTimeslice
    ? [...resp.records].sort(
        (a, b) =>
          Number(a.map["_timeslice"] ?? 0) - Number(b.map["_timeslice"] ?? 0)
      )
    : resp.records;
  const header = fieldNames.join(" | ");
  const rows = records.map((rec) =>
    fieldNames.map((f) => rec.map[f] ?? "").join(" | ")
  );

  return `${records.length} records:\n${header}\n${"─".repeat(header.length)}\n${rows.join("\n")}`;
}

async function searchForAccount(
  client: SumoClient,
  accountName: string,
  params: {
    query: string;
    from: string;
    to: string;
    timeZone: string;
    limit: number;
    byReceiptTime: boolean;
  }
): Promise<string> {
  const finalQuery = addLimitIfNeeded(params.query, params.limit);
  const job = await client.post<CreateSearchJobResponse>(
    "/v1/search/jobs",
    {
      query: finalQuery,
      from: params.from,
      to: params.to,
      timeZone: params.timeZone,
      byReceiptTime: params.byReceiptTime,
    },
    accountName
  );

  const jobId = job.id;

  try {
    const status = await pollUntilDone(client, jobId, accountName);

    let resultText: string;
    if (status.recordCount > 0) {
      const records = await client.get<SearchRecordsResponse>(
        `/v1/search/jobs/${jobId}/records`,
        { offset: 0, limit: params.limit },
        accountName
      );
      resultText = formatRecords(records);
    } else {
      const messages = await client.get<SearchMessagesResponse>(
        `/v1/search/jobs/${jobId}/messages`,
        { offset: 0, limit: params.limit },
        accountName
      );
      resultText = formatMessages(messages);
    }

    const warnings = status.pendingWarnings;
    const warningText =
      warnings && warnings.length > 0
        ? `\nWarnings:\n${warnings.join("\n")}`
        : "";

    return `Search completed (${status.messageCount} total messages, ${status.recordCount} total records).\n\n${resultText}${warningText}`;
  } finally {
    try {
      await client.delete(`/v1/search/jobs/${jobId}`, accountName);
    } catch {
      // best-effort cleanup
    }
  }
}

export function registerSearchJobTools(
  server: McpServer,
  client: SumoClient,
  configManager: ConfigManager,
  options?: { enableLowLevelTools?: boolean }
): void {
  // High-level search: create, poll, fetch, cleanup
  server.tool(
    "sumo_search",
    "Run a Sumo Logic search query and return results (handles job lifecycle automatically)",
    {
      account: z.string().describe("Name of the Sumo Logic account to use"),
      query: z.string().describe("Sumo Logic query string"),
      from: z
        .string()
        .describe(
          "Start time — ISO 8601 (e.g. '2024-01-01T00:00:00Z') or relative (e.g. '-15m', '-1h', '-1d')"
        ),
      to: z
        .string()
        .describe(
          "End time — ISO 8601 (e.g. '2024-01-01T01:00:00Z') or relative (e.g. '-0m')"
        ),
      timeZone: z
        .string()
        .optional()
        .describe("Time zone (default: UTC), e.g. 'America/Los_Angeles'"),
      limit: z
        .number()
        .optional()
        .describe("Max number of results to return (default: 100, max: 10000)"),
      byReceiptTime: z
        .boolean()
        .optional()
        .describe("Use receipt time instead of message time (default: false)"),
    },
    async ({ account, query, from, to, timeZone, limit, byReceiptTime }) => {
      try {
        const resultLimit = Math.min(limit ?? 100, 10000);
        const finalQuery = addLimitIfNeeded(query, resultLimit);

        // 1. Create job
        const job = await client.post<CreateSearchJobResponse>(
          "/v1/search/jobs",
          {
            query: finalQuery,
            from: resolveTimeToISO(from),
            to: resolveTimeToISO(to),
            timeZone: timeZone ?? "UTC",
            byReceiptTime: byReceiptTime ?? false,
          },
          account
        );

        const jobId = job.id;

        try {
          // 2. Poll until done
          const status = await pollUntilDone(client, jobId, account);

          // 3. Fetch results - records if aggregation, messages otherwise
          let resultText: string;

          if (status.recordCount > 0) {
            const records = await client.get<SearchRecordsResponse>(
              `/v1/search/jobs/${jobId}/records`,
              { offset: 0, limit: resultLimit },
              account
            );
            resultText = formatRecords(records);
          } else {
            const messages = await client.get<SearchMessagesResponse>(
              `/v1/search/jobs/${jobId}/messages`,
              { offset: 0, limit: resultLimit },
              account
            );
            resultText = formatMessages(messages);
          }

          // Add warnings if any
          const warnings = status.pendingWarnings;
          const warningText =
            warnings && warnings.length > 0
              ? `\n\nWarnings:\n${warnings.join("\n")}`
              : "";

          return {
            content: [
              {
                type: "text" as const,
                text: `Search completed (${status.messageCount} total messages, ${status.recordCount} total records).\n\n${resultText}${warningText}`,
              },
            ],
          };
        } finally {
          // 4. Cleanup
          try {
            await client.delete(`/v1/search/jobs/${jobId}`, account);
          } catch {
            // best-effort cleanup
          }
        }
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Search error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  if (options?.enableLowLevelTools) {
  // Low-level: Create search job
  server.tool(
    "sumo_create_search_job",
    "Create an async Sumo Logic search job (returns job ID for polling)",
    {
      account: z.string().describe("Name of the Sumo Logic account to use"),
      query: z.string().describe("Sumo Logic query string"),
      from: z.string().describe("Start time — ISO 8601 (e.g. '2024-01-01T00:00:00Z') or relative (e.g. '-15m', '-1h', '-1d')"),
      to: z.string().describe("End time — ISO 8601 (e.g. '2024-01-01T01:00:00Z') or relative (e.g. '-0m')"),
      timeZone: z.string().optional().describe("Time zone (default: UTC)"),
      byReceiptTime: z
        .boolean()
        .optional()
        .describe("Use receipt time (default: false)"),
    },
    async ({ account, query, from, to, timeZone, byReceiptTime }) => {
      try {
        const job = await client.post<CreateSearchJobResponse>(
          "/v1/search/jobs",
          {
            query,
            from: resolveTimeToISO(from),
            to: resolveTimeToISO(to),
            timeZone: timeZone ?? "UTC",
            byReceiptTime: byReceiptTime ?? false,
          },
          account
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `Search job created. Job ID: ${job.id}\nUse sumo_get_search_job_status to check progress.`,
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

  // Low-level: Get search job status
  server.tool(
    "sumo_get_search_job_status",
    "Get the status of a Sumo Logic search job",
    {
      account: z.string().describe("Name of the Sumo Logic account to use"),
      jobId: z.string().describe("Search job ID"),
    },
    async ({ account, jobId }) => {
      try {
        const status = await client.get<SearchJobStatus>(
          `/v1/search/jobs/${jobId}`,
          undefined,
          account
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `Job ${jobId}:\n  State: ${status.state}\n  Messages: ${status.messageCount}\n  Records: ${status.recordCount}${
                status.pendingWarnings?.length
                  ? `\n  Warnings: ${status.pendingWarnings.join("; ")}`
                  : ""
              }${
                status.pendingErrors?.length
                  ? `\n  Errors: ${status.pendingErrors.join("; ")}`
                  : ""
              }`,
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

  // Low-level: Get messages
  server.tool(
    "sumo_get_search_job_messages",
    "Get log messages from a completed Sumo Logic search job",
    {
      account: z.string().describe("Name of the Sumo Logic account to use"),
      jobId: z.string().describe("Search job ID"),
      offset: z.number().optional().describe("Result offset (default: 0)"),
      limit: z
        .number()
        .optional()
        .describe("Number of messages to return (default: 100, max: 10000)"),
    },
    async ({ account, jobId, offset, limit }) => {
      try {
        const resp = await client.get<SearchMessagesResponse>(
          `/v1/search/jobs/${jobId}/messages`,
          { offset: offset ?? 0, limit: Math.min(limit ?? 100, 10000) },
          account
        );

        return {
          content: [
            {
              type: "text" as const,
              text: formatMessages(resp),
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

  // Low-level: Get records
  server.tool(
    "sumo_get_search_job_records",
    "Get aggregated records from a completed Sumo Logic search job",
    {
      account: z.string().describe("Name of the Sumo Logic account to use"),
      jobId: z.string().describe("Search job ID"),
      offset: z.number().optional().describe("Result offset (default: 0)"),
      limit: z
        .number()
        .optional()
        .describe("Number of records to return (default: 100, max: 10000)"),
    },
    async ({ account, jobId, offset, limit }) => {
      try {
        const resp = await client.get<SearchRecordsResponse>(
          `/v1/search/jobs/${jobId}/records`,
          { offset: offset ?? 0, limit: Math.min(limit ?? 100, 10000) },
          account
        );

        return {
          content: [
            {
              type: "text" as const,
              text: formatRecords(resp),
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

  } // end if enableLowLevelTools

  // Multi-account: search all accounts in parallel
  server.tool(
    "sumo_search_all",
    "Run a Sumo Logic search query across ALL configured accounts in parallel and return aggregated results",
    {
      query: z.string().describe("Sumo Logic query string"),
      from: z
        .string()
        .describe(
          "Start time — ISO 8601 (e.g. '2024-01-01T00:00:00Z') or relative (e.g. '-15m', '-1h', '-1d')"
        ),
      to: z
        .string()
        .describe(
          "End time — ISO 8601 (e.g. '2024-01-01T01:00:00Z') or relative (e.g. '-0m')"
        ),
      timeZone: z
        .string()
        .optional()
        .describe("Time zone (default: UTC), e.g. 'America/Los_Angeles'"),
      limit: z
        .number()
        .optional()
        .describe("Max number of results per account (default: 100, max: 10000)"),
      byReceiptTime: z
        .boolean()
        .optional()
        .describe("Use receipt time instead of message time (default: false)"),
    },
    async ({ query, from, to, timeZone, limit, byReceiptTime }) => {
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

        const resultLimit = Math.min(limit ?? 100, 10000);
        const searchParams = {
          query,
          from: resolveTimeToISO(from),
          to: resolveTimeToISO(to),
          timeZone: timeZone ?? "UTC",
          limit: resultLimit,
          byReceiptTime: byReceiptTime ?? false,
        };

        const accounts = configManager.listAccounts();
        const accountDeployments = new Map(
          accounts.map(a => [a.name, a.deployment])
        );

        const results = await Promise.allSettled(
          accountNames.map(name => searchForAccount(client, name, searchParams))
        );

        const sections: string[] = [];
        for (let i = 0; i < accountNames.length; i++) {
          const name = accountNames[i];
          const deployment = accountDeployments.get(name) ?? "unknown";
          const result = results[i];

          if (result.status === "fulfilled") {
            sections.push(`=== Account: ${name} (${deployment}) ===\n${result.value}`);
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
              text: `Search all error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
