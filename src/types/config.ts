export type DeploymentRegion =
  | "AU"
  | "CA"
  | "DE"
  | "EU"
  | "FED"
  | "IN"
  | "JP"
  | "KR"
  | "US1"
  | "US2";

export interface AccountConfig {
  deployment: string;
  accessId: string;
  accessKey: string;
}

export interface McpConfig {
  accounts: Record<string, AccountConfig>;
}
