export interface HttpClient {
  get<T>(url: string): Promise<T>;
  getText(url: string): Promise<string>;
}

export interface FetchHttpClientOptions {
  maxRetries?: number;
  baseRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  retryStatuses?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_RETRY_STATUSES = [429, 502, 503, 504] as const;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_RETRY_DELAY_MS = 250;
const DEFAULT_MAX_RETRY_DELAY_MS = 2_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const parseRetryAfterMs = (value: string | null): number | null => {
  if (!value) {
    return null;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.floor(seconds * 1000);
  }

  const timestamp = Date.parse(value);
  if (!Number.isNaN(timestamp)) {
    return Math.max(0, timestamp - Date.now());
  }

  return null;
};

export class FetchHttpClient implements HttpClient {
  private readonly maxRetries: number;
  private readonly baseRetryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly retryStatuses: Set<number>;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: FetchHttpClientOptions = {}) {
    this.maxRetries = Math.max(0, Math.floor(options.maxRetries ?? DEFAULT_MAX_RETRIES));
    this.baseRetryDelayMs = Math.max(0, Math.floor(options.baseRetryDelayMs ?? DEFAULT_BASE_RETRY_DELAY_MS));
    this.maxRetryDelayMs = Math.max(
      this.baseRetryDelayMs,
      Math.floor(options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS),
    );
    this.retryStatuses = new Set(options.retryStatuses ?? DEFAULT_RETRY_STATUSES);
    this.sleep = options.sleep ?? sleep;
  }

  async get<T>(url: string): Promise<T> {
    const response = await this.fetchWithRetry(url);
    return response.json() as Promise<T>;
  }

  async getText(url: string): Promise<string> {
    const response = await this.fetchWithRetry(url);
    return response.text();
  }

  private async fetchWithRetry(url: string): Promise<Response> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const response = await fetch(url);
      if (response.ok) {
        return response;
      }

      if (!this.retryStatuses.has(response.status) || attempt >= this.maxRetries) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      await this.sleep(this.resolveRetryDelayMs(response, attempt));
    }

    throw new Error("HTTP retry failed unexpectedly");
  }

  private resolveRetryDelayMs(response: Response, attempt: number): number {
    const retryAfterMs = parseRetryAfterMs(response.headers.get("Retry-After"));
    if (retryAfterMs !== null) {
      return Math.min(retryAfterMs, this.maxRetryDelayMs);
    }

    const exponentialDelayMs = this.baseRetryDelayMs * (2 ** attempt);
    return Math.min(exponentialDelayMs, this.maxRetryDelayMs);
  }
}
