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
  | "STAG"
  | "US1"
  | "US2";

export interface AccountConfig {
  deployment: DeploymentRegion;
  accessId: string;
  accessKey: string;
}

export interface McpConfig {
  accounts: Record<string, AccountConfig>;
}
