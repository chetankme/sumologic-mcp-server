import { DeploymentRegion } from "../types/config.js";

export const DEPLOYMENT_URLS: Record<DeploymentRegion, string> = {
  AU: "https://api.au.sumologic.com/api",
  CA: "https://api.ca.sumologic.com/api",
  DE: "https://api.de.sumologic.com/api",
  EU: "https://api.eu.sumologic.com/api",
  FED: "https://api.fed.sumologic.com/api",
  IN: "https://api.in.sumologic.com/api",
  JP: "https://api.jp.sumologic.com/api",
  KR: "https://api.kr.sumologic.com/api",
  LONG: "https://long-api.sumologic.net/api",
  US1: "https://api.sumologic.com/api",
  US2: "https://api.us2.sumologic.com/api",
};

export function getBaseUrl(deployment: DeploymentRegion): string {
  const url = DEPLOYMENT_URLS[deployment];
  if (!url) {
    throw new Error(`Unknown deployment region: ${deployment}`);
  }
  return url;
}

export function isValidDeployment(value: string): value is DeploymentRegion {
  return value in DEPLOYMENT_URLS;
}
