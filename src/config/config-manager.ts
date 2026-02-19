import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { AccountConfig, McpConfig, DeploymentRegion } from "../types/config.js";
import { isValidDeployment } from "./deployments.js";

const CONFIG_DIR = join(homedir(), ".sumologic");
const CONFIG_FILE = join(CONFIG_DIR, "mcp-config.json");

function defaultConfig(): McpConfig {
  return {
    accounts: {},
  };
}

export class ConfigManager {
  private config: McpConfig = defaultConfig();

  async load(): Promise<void> {
    try {
      const data = await readFile(CONFIG_FILE, "utf-8");
      this.config = JSON.parse(data) as McpConfig;
    } catch {
      this.config = defaultConfig();
    }
  }

  private async save(): Promise<void> {
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(CONFIG_FILE, JSON.stringify(this.config, null, 2), "utf-8");
  }

  getConfigPath(): string {
    return CONFIG_FILE;
  }

  getAccount(name: string): AccountConfig | null {
    return this.config.accounts[name] ?? null;
  }

  listAccounts(): Array<{
    name: string;
    deployment: DeploymentRegion;
    accessId: string;
  }> {
    return Object.entries(this.config.accounts).map(([name, acct]) => ({
      name,
      deployment: acct.deployment,
      accessId: acct.accessId,
    }));
  }

  async addAccount(
    name: string,
    deployment: string,
    accessId: string,
    accessKey: string
  ): Promise<void> {
    if (!isValidDeployment(deployment)) {
      throw new Error(
        `Invalid deployment "${deployment}". Valid: AU, CA, DE, EU, FED, IN, JP, KR, US1, US2`
      );
    }

    this.config.accounts[name] = {
      deployment,
      accessId,
      accessKey,
    };

    await this.save();
  }

}
