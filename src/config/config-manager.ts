import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { AccountConfig, McpConfig } from "../types/config.js";

const CONFIG_DIR = join(homedir(), ".sumologic");
const PRIMARY_CONFIG_FILE = join(CONFIG_DIR, "access-keys.json");
const LEGACY_CONFIG_FILE = join(CONFIG_DIR, "mcp-config.json");

const PLACEHOLDER = "...";

function defaultConfig(): McpConfig {
  return {
    accounts: {},
  };
}

function sampleAccount(deployment: string): AccountConfig {
  return { deployment, accessId: PLACEHOLDER, accessKey: PLACEHOLDER };
}

function sampleConfig(): McpConfig {
  return {
    accounts: {
      escData: sampleAccount("LONG"),
      zrhData: sampleAccount("LONG"),
      monData: sampleAccount("LONG"),
      tkyData: sampleAccount("LONG"),
      cseData: sampleAccount("LONG"),
      jenkinsData: sampleAccount("LONG"),
      fedData: sampleAccount("LONG"),
      korData: sampleAccount("LONG"),
      stagData: sampleAccount("LONG"),
      sydData: sampleAccount("LONG"),
      epdData: sampleAccount("STAG"),
      dubData: sampleAccount("LONG"),
      longData: sampleAccount("US1"),
      us1Data: sampleAccount("LONG"),
      us2Data: sampleAccount("LONG"),
      fraData: sampleAccount("LONG"),
    },
  };
}

export class ConfigManager {
  private resolvedPath: string = PRIMARY_CONFIG_FILE;

  async load(): Promise<void> {
    if (existsSync(PRIMARY_CONFIG_FILE)) {
      this.resolvedPath = PRIMARY_CONFIG_FILE;
      return;
    }

    if (existsSync(LEGACY_CONFIG_FILE)) {
      this.resolvedPath = LEGACY_CONFIG_FILE;
      return;
    }

    // Neither file exists: bootstrap a sample config at the primary location.
    this.resolvedPath = PRIMARY_CONFIG_FILE;
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(
      PRIMARY_CONFIG_FILE,
      JSON.stringify(sampleConfig(), null, 2),
      "utf-8"
    );
    console.error(
      `No Sumo Logic config found. Created a sample config at ${PRIMARY_CONFIG_FILE} — fill in accessId/accessKey before use.`
    );
  }

  private readConfig(): McpConfig {
    try {
      const data = readFileSync(this.resolvedPath, "utf-8");
      return JSON.parse(data) as McpConfig;
    } catch (err) {
      console.error(
        `Failed to read/parse Sumo Logic config at ${this.resolvedPath}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      return defaultConfig();
    }
  }

  private isPlaceholder(account: AccountConfig): boolean {
    return (
      !account.accessId?.trim() ||
      !account.accessKey?.trim() ||
      account.accessId.trim() === PLACEHOLDER ||
      account.accessKey.trim() === PLACEHOLDER
    );
  }

  getConfigPath(): string {
    return this.resolvedPath;
  }

  getAccount(name: string): AccountConfig | null {
    const account = this.readConfig().accounts[name];
    if (!account) return null;

    if (this.isPlaceholder(account)) {
      throw new Error(
        `Account "${name}" has placeholder credentials. Fill in accessId/accessKey in ${this.resolvedPath}.`
      );
    }

    return account;
  }

  listAccounts(): Array<{
    name: string;
    deployment: string;
    accessId: string;
  }> {
    return Object.entries(this.readConfig().accounts).map(([name, acct]) => ({
      name,
      deployment: acct.deployment,
      accessId: acct.accessId,
    }));
  }

  listValidAccountNames(): string[] {
    return Object.entries(this.readConfig().accounts)
      .filter(([, acct]) => !this.isPlaceholder(acct))
      .map(([name]) => name);
  }
}
