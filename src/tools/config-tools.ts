import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConfigManager } from "../config/config-manager.js";

export function registerConfigTools(
  server: McpServer,
  configManager: ConfigManager
): void {
  server.tool(
    "sumo_remove_account",
    "Remove a Sumo Logic account configuration",
    {
      name: z.string().describe("Name of the account to remove"),
    },
    async ({ name }) => {
      try {
        await configManager.removeAccount(name);
        return {
          content: [
            {
              type: "text" as const,
              text: `Account "${name}" removed.`,
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
