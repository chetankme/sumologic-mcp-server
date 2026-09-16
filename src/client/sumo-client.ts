import { ConfigManager } from "../config/config-manager.js";
import { getBaseUrl } from "../config/deployments.js";
import { AccountConfig } from "../types/config.js";

interface RateLimiter {
  tokens: number;
  maxTokens: number;
  refillRate: number; // tokens per ms
  lastRefill: number;
}

function createRateLimiter(requestsPerSecond: number): RateLimiter {
  return {
    tokens: requestsPerSecond,
    maxTokens: requestsPerSecond,
    refillRate: requestsPerSecond / 1000,
    lastRefill: Date.now(),
  };
}

async function acquireToken(limiter: RateLimiter): Promise<void> {
  const now = Date.now();
  const elapsed = now - limiter.lastRefill;
  limiter.tokens = Math.min(
    limiter.maxTokens,
    limiter.tokens + elapsed * limiter.refillRate
  );
  limiter.lastRefill = now;

  if (limiter.tokens < 1) {
    const waitMs = Math.ceil((1 - limiter.tokens) / limiter.refillRate);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    limiter.tokens = 0;
    limiter.lastRefill = Date.now();
  } else {
    limiter.tokens -= 1;
  }
}

export class SumoClient {
  private configManager: ConfigManager;
  private rateLimiters = new Map<string, RateLimiter>();
  private maxRetries = 3;

  constructor(configManager: ConfigManager) {
    this.configManager = configManager;
  }

  private getAccountByName(accountName: string): { name: string; account: AccountConfig } {
    const account = this.configManager.getAccount(accountName);
    if (!account) throw new Error(`Account "${accountName}" not found`);
    return { name: accountName, account };
  }

  private getRateLimiter(accountName: string): RateLimiter {
    let limiter = this.rateLimiters.get(accountName);
    if (!limiter) {
      limiter = createRateLimiter(4); // 4 requests/sec per account
      this.rateLimiters.set(accountName, limiter);
    }
    return limiter;
  }

  getAllAccountNames(): string[] {
    return this.configManager.listValidAccountNames();
  }

  private buildAuthHeader(account: AccountConfig): string {
    const credentials = Buffer.from(
      `${account.accessId}:${account.accessKey}`
    ).toString("base64");
    return `Basic ${credentials}`;
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    queryParams?: Record<string, string | number | boolean | undefined>,
    accountName?: string
  ): Promise<T> {
    if (!accountName) throw new Error("Account name is required");
    const { name, account } = this.getAccountByName(accountName);
    const baseUrl = getBaseUrl(account.deployment);

    let url = `${baseUrl}${path}`;

    if (queryParams) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined) {
          params.set(key, String(value));
        }
      }
      const qs = params.toString();
      if (qs) {
        url += `?${qs}`;
      }
    }

    const headers: Record<string, string> = {
      Authorization: this.buildAuthHeader(account),
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await acquireToken(this.getRateLimiter(name));

      try {
        const response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });

        if (response.ok) {
          // Some DELETE endpoints return no content
          if (response.status === 204) {
            return undefined as T;
          }
          const text = await response.text();
          if (!text) {
            return undefined as T;
          }
          return JSON.parse(text) as T;
        }

        if (response.status === 429) {
          const retryAfter = response.headers.get("Retry-After");
          const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 1000;
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }

        if (response.status >= 500 && attempt < this.maxRetries) {
          const backoff = Math.pow(2, attempt) * 500;
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }

        // Non-retryable error
        const errorBody = await response.text().catch(() => "");
        let errorMessage: string;
        try {
          const parsed = JSON.parse(errorBody);
          errorMessage =
            parsed.message || parsed.errors?.[0]?.message || errorBody;
        } catch {
          errorMessage = errorBody;
        }

        throw new Error(
          `Sumo Logic API error (${response.status}): ${errorMessage}`
        );
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("Sumo Logic API")) {
          throw err;
        }
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.maxRetries) {
          const backoff = Math.pow(2, attempt) * 500;
          await new Promise((resolve) => setTimeout(resolve, backoff));
        }
      }
    }

    throw lastError ?? new Error("Request failed after retries");
  }

  async get<T>(
    path: string,
    queryParams?: Record<string, string | number | boolean | undefined>,
    accountName?: string
  ): Promise<T> {
    return this.request<T>("GET", path, undefined, queryParams, accountName);
  }

  async post<T>(path: string, body?: unknown, accountName?: string): Promise<T> {
    return this.request<T>("POST", path, body, undefined, accountName);
  }

  async delete<T>(path: string, accountName?: string): Promise<T> {
    return this.request<T>("DELETE", path, undefined, undefined, accountName);
  }
}
