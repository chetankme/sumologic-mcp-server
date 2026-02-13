import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConfigManager } from "../config/config-manager.js";

export function registerConfigTools(
  server: McpServer,
  configManager: ConfigManager
): void {
  server.tool(
    "sumo_add_account",
    "Add a new Sumo Logic account configuration",
    {
      name: z.string().describe("Friendly name for this account (e.g. 'us1-prod')"),
      deployment: z
        .enum(["AU", "CA", "DE", "EU", "FED", "IN", "JP", "KR", "US1", "US2"])
        .describe("Sumo Logic deployment region"),
      accessId: z.string().describe("Sumo Logic Access ID"),
      accessKey: z.string().describe("Sumo Logic Access Key"),
    },
    async ({ name, deployment, accessId, accessKey }) => {
      try {
        await configManager.addAccount(name, deployment, accessId, accessKey);
        const isActive = configManager.getActiveAccount()?.name === name;
        return {
          content: [
            {
              type: "text" as const,
              text: `Account "${name}" added for deployment ${deployment}.${isActive ? " (set as active)" : ""}`,
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
    "sumo_switch_account",
    "Switch the active Sumo Logic account",
    {
      name: z.string().describe("Name of the account to switch to"),
    },
    async ({ name }) => {
      try {
        await configManager.switchAccount(name);
        const acct = configManager.getAccount(name);
        return {
          content: [
            {
              type: "text" as const,
              text: `Switched to account "${name}" (deployment: ${acct?.deployment}).`,
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
              text: "No accounts configured. Use sumo_add_account to add one.",
            },
          ],
        };
      }

      const lines = accounts.map((a) => {
        const marker = a.isActive ? " (active)" : "";
        const maskedId = a.accessId.slice(0, 4) + "****";
        return `- ${a.name}: deployment=${a.deployment}, accessId=${maskedId}${marker}`;
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
