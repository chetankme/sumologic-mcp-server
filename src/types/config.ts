export type DeploymentRegion =
  | "AU"
  | "CA"
  | "DE"
  | "EU"
  | "FED"
  | "IN"
  | "JP"
  | "KR"
  | "LONG"
  | "US1"
  | "US2";

export interface AccountConfig {
  deployment: DeploymentRegion;
  accessId: string;
  accessKey: string;
}

export interface McpConfig {
  activeAccount: string | null;
  accounts: Record<string, AccountConfig>;
}
