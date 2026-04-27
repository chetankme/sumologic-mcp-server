import { exec } from "node:child_process";
import { platform } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConfigManager } from "../config/config-manager.js";

export function registerConfigTools(
  server: McpServer,
  configManager: ConfigManager
): void {
  server.tool(
    "configure_sumo_accounts",
    "Open the Sumo Logic MCP config file (~/.sumologic/mcp-config.json) in the system default editor",
    {},
    async () => {
      const configPath = configManager.getConfigPath();
      const os = platform();
      const cmd =
        os === "darwin"
          ? `open "${configPath}"`
          : os === "win32"
            ? `start "" "${configPath}"`
            : `xdg-open "${configPath}"`;

      try {
        await new Promise<void>((resolve, reject) => {
          exec(cmd, (err) => (err ? reject(err) : resolve()));
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Opened config file in default editor: ${configPath}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error opening config: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "sumo_list_accounts",
    "List all configured Sumo Logic accounts",
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

      const lines = accounts.map((a) => `- ${a.name}`);

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
