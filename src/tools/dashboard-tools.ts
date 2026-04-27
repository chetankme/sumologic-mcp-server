import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SumoClient } from "../client/sumo-client.js";
import { ConfigManager } from "../config/config-manager.js";
import { Dashboard, DashboardPanel, PaginatedDashboards } from "../types/dashboard.js";

function formatTimeRange(timeRange: unknown): string {
  if (!timeRange || typeof timeRange !== "object") return "Not set";
  const tr = timeRange as Record<string, unknown>;
  if (tr.type === "BeginBoundedTimeRange") {
    const from = tr.from as Record<string, unknown> | undefined;
    const to = tr.to as Record<string, unknown> | undefined;
    const fromStr = from?.relativeTime ?? from?.epochMillis ?? "?";
    const toStr = to?.relativeTime ?? to?.epochMillis ?? "now";
    return `${fromStr} to ${toStr}`;
  }
  return JSON.stringify(timeRange);
}

function getChartType(panel: DashboardPanel): string {
  if (!panel.visualSettings) return "unknown";
  try {
    const vs = JSON.parse(panel.visualSettings);
    return vs.general?.type ?? "unknown";
  } catch {
    return "unknown";
  }
}

function formatDashboard(d: Dashboard): string {
  const lines: string[] = [];
  lines.push(`Dashboard: ${d.title}`);
  lines.push(`  ID: ${d.id}`);
  if (d.description) lines.push(`  Description: ${d.description}`);
  if (d.domain) lines.push(`  Domain: ${d.domain}`);
  lines.push(`  Theme: ${d.theme ?? "Light"}`);
  lines.push(`  Time Range: ${formatTimeRange(d.timeRange)}`);
  if (d.refreshInterval !== undefined) lines.push(`  Refresh Interval: ${d.refreshInterval}s`);
  lines.push(`  Panels: ${d.panels?.length ?? 0}`);
  lines.push(`  Variables: ${d.variables?.length ?? 0}`);
  lines.push(`  Public: ${d.isPublic ?? false}`);
  if (d.folderId) lines.push(`  Folder ID: ${d.folderId}`);
  if (d.contentId) lines.push(`  Content ID: ${d.contentId}`);

  // Panel details
  if (d.panels && d.panels.length > 0) {
    lines.push("");
    lines.push("--- Panels ---");
    for (let i = 0; i < d.panels.length; i++) {
      const panel = d.panels[i];
      lines.push("");
      lines.push(`[${i + 1}] ${panel.title}`);
      lines.push(`    Type: ${panel.panelType} | Chart: ${getChartType(panel)}`);
      if (panel.description) lines.push(`    Description: ${panel.description}`);
      if (panel.timeRange) lines.push(`    Time Range Override: ${formatTimeRange(panel.timeRange)}`);

      if (panel.queries && panel.queries.length > 0) {
        for (const q of panel.queries) {
          lines.push(`    Query ${q.queryKey} (${q.queryType}):`);
          lines.push(`      ${q.queryString.replace(/\n/g, "\n      ")}`);
        }
      }
    }
  }

  // Variables
  if (d.variables && d.variables.length > 0) {
    lines.push("");
    lines.push("--- Variables ---");
    for (const v of d.variables) {
      lines.push(`  ${v.name}${v.displayName ? ` (${v.displayName})` : ""}${v.defaultValue ? ` = ${v.defaultValue}` : ""}`);
    }
  }

  return lines.join("\n");
}

export function registerDashboardTools(
  server: McpServer,
  client: SumoClient,
  configManager: ConfigManager,
): void {
  server.tool(
    "sumo_get_dashboard",
    "Get a Sumo Logic dashboard by ID, including its panels, variables, and layout",
    {
      account: z.string().describe("Name of the Sumo Logic account to use"),
      id: z.string().describe("UUID of the dashboard to retrieve"),
    },
    async ({ account, id }) => {
      try {
        const dashboard = await client.get<Dashboard>(
          `/v2/dashboards/${id}`,
          undefined,
          account,
        );

        const output = formatDashboard(dashboard);

        return {
          content: [{ type: "text" as const, text: output }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error fetching dashboard: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "sumo_list_dashboards",
    "List all dashboards in a Sumo Logic account",
    {
      account: z.string().describe("Name of the Sumo Logic account to use"),
      limit: z.number().min(1).max(100).optional().describe("Max number of dashboards to return (default: 50, max: 100)"),
      token: z.string().optional().describe("Pagination continuation token from a previous response"),
      mode: z.enum(["createdByUser", "allViewableByUser"]).optional().describe("Whether to list only dashboards created by the user or all viewable dashboards"),
    },
    async ({ account, limit, token, mode }) => {
      try {
        const queryParams: Record<string, string | number | boolean | undefined> = {};
        if (limit !== undefined) queryParams.limit = limit;
        if (token !== undefined) queryParams.token = token;
        if (mode !== undefined) queryParams.mode = mode;

        const result = await client.get<PaginatedDashboards>(
          "/v2/dashboards",
          Object.keys(queryParams).length > 0 ? queryParams : undefined,
          account,
        );

        const lines: string[] = [];
        lines.push(`Found ${result.dashboards.length} dashboard(s):\n`);

        for (const d of result.dashboards) {
          const desc = d.description
            ? d.description.length > 80 ? d.description.slice(0, 80) + "..." : d.description
            : "";
          lines.push(`- ${d.title} (ID: ${d.id})`);
          if (desc) lines.push(`  ${desc}`);
          lines.push(`  Panels: ${d.panels?.length ?? 0} | Theme: ${d.theme ?? "Light"}`);
        }

        if (result.next) {
          lines.push(`\nMore results available. Use token: ${result.next}`);
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error listing dashboards: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );
}
