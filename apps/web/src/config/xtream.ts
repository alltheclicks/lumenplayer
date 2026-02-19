import type { XtreamCredentials } from "@lumen/types";

const XTREAM_DEV_PROXY_BASE_PATH = "/xui-api";

const trimTrailingSlash = (value: string): string => value.trim().replace(/\/+$/, "");

// Xtream Codes server configuration from environment variable
export const XTREAM_SERVER_URL = trimTrailingSlash(import.meta.env.VITE_XTREAM_SERVER || "");

export const resolveXtreamApiServer = (
  serverUrl: string,
  options: {
    isDev?: boolean;
    origin?: string | null;
  } = {},
): string => {
  const normalizedServer = trimTrailingSlash(serverUrl);
  const isDevMode = options.isDev ?? import.meta.env.DEV;
  const runtimeOrigin = options.origin ?? (typeof window === "undefined" ? null : window.location.origin);

  if (!isDevMode || !runtimeOrigin) {
    return normalizedServer;
  }

  return `${trimTrailingSlash(runtimeOrigin)}${XTREAM_DEV_PROXY_BASE_PATH}`;
};

export const resolveXtreamRuntimeCredentials = (
  credentials: XtreamCredentials,
  options: {
    isDev?: boolean;
    origin?: string | null;
  } = {},
): XtreamCredentials => ({
  ...credentials,
  server: resolveXtreamApiServer(credentials.server, options),
});

export const isServerConfigured = (): boolean => {
  return XTREAM_SERVER_URL.length > 0 && !XTREAM_SERVER_URL.includes("your-server");
};

export const getServerDisplayName = (): string => {
  if (!isServerConfigured()) return "Nije konfigurisan";
  try {
    const url = new URL(XTREAM_SERVER_URL);
    return url.hostname;
  } catch {
    return "Konfigurisan";
  }
};
