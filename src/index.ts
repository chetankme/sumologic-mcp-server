import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigManager } from "./config/config-manager.js";
import { SumoClient } from "./client/sumo-client.js";
import { registerConfigTools } from "./tools/config-tools.js";
import { registerSearchJobTools } from "./tools/search-job-tools.js";
import { registerMetricsTools } from "./tools/metrics-tools.js";
import { registerDashboardTools } from "./tools/dashboard-tools.js";

async function main(): Promise<void> {
  const server = new McpServer({
    name: "sumologic",
    version: "1.0.0",
  });

  // Initialize config manager
  const configManager = new ConfigManager();
  await configManager.load();

  // Initialize HTTP client
  const client = new SumoClient(configManager);

  // Register all tools
  const enableLowLevelTools = process.env.SUMO_ENABLE_LOW_LEVEL_TOOLS === 'true';
  registerConfigTools(server, configManager);
  registerSearchJobTools(server, client, configManager, { enableLowLevelTools });
  registerMetricsTools(server, client, configManager);
  registerDashboardTools(server, client, configManager);

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (stdout is reserved for MCP protocol)
  console.error("Sumo Logic MCP server started");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
