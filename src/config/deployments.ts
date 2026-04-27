import { DeploymentRegion } from "../types/config.js";

const PUBLIC_REGIONS: ReadonlySet<DeploymentRegion> = new Set([
  "AU", "CA", "DE", "EU", "FED", "IN", "JP", "KR", "US1", "US2",
]);

export function getBaseUrl(deployment: string): string {
  if (deployment === "US1") {
    return "https://api.sumologic.com/api";
  }
  const lower = deployment.toLowerCase();
  if (PUBLIC_REGIONS.has(deployment as DeploymentRegion)) {
    return `https://api.${lower}.sumologic.com/api`;
  }
  return `https://${lower}-api.sumologic.net/api`;
}

export function isValidDeployment(value: string): boolean {
  return /^[A-Z0-9]+$/.test(value);
}
