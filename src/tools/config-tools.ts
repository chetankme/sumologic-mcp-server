import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConfigManager } from "../config/config-manager.js";

export function registerConfigTools(
  server: McpServer,
  configManager: ConfigManager
): void {
  server.tool(
    "sumo_list_accounts",
    "List all configured Sumo Logic accounts (access keys are masked)",
    {},
    async () => {
      const accounts = configManager.listAccounts();
      if (accounts.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No accounts configured.",
            },
          ],
        };
      }

      const lines = accounts.map((a) => {
        const maskedId = a.accessId.slice(0, 4) + "****";
        return `- ${a.name}: deployment=${a.deployment}, accessId=${maskedId}`;
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Configured accounts:\n${lines.join("\n")}`,
          },
        ],
      };
    }
  );
}
