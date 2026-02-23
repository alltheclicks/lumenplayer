import type { XtreamCredentials, XtreamServerInfo } from "@lumen/types";

export const XTREAM_DEV_PROXY_BASE_PATH = "/xui-api";

const trimTrailingSlash = (value: string): string => value.trim().replace(/\/+$/, "");
const trimLeadingSlash = (value: string): string => value.replace(/^\/+/, "");
const isDefaultPort = (protocol: string, port: string): boolean => (
  (protocol === "http" && port === "80") ||
  (protocol === "https" && port === "443")
);
const resolveProtocol = (protocol: string | undefined, fallback: string): "http" | "https" => {
  if (protocol === "http" || protocol === "https") {
    return protocol;
  }
  return fallback === "https" ? "https" : "http";
};

const parseServerInfoHost = (value: string): {
  host: string;
  protocol?: "http" | "https";
  port?: string;
} => {
  const normalized = value.trim();
  if (!normalized) {
    return { host: "" };
  }

  try {
    const parsed = new URL(normalized.includes("://") ? normalized : `http://${normalized}`);
    return {
      host: parsed.hostname,
      protocol: normalized.includes("://") ? resolveProtocol(parsed.protocol.replace(":", ""), "http") : undefined,
      port: parsed.port || undefined,
    };
  } catch {
    return {
      host: normalized.replace(/^https?:\/\//, "").split("/")[0],
    };
  }
};

const normalizeXtreamTargetBase = (value: string): string | null => {
  const normalized = trimTrailingSlash(value);
  if (!normalized) {
    return null;
  }

  try {
    const parsed = new URL(normalized.includes("://") ? normalized : `http://${normalized}`);
    const protocol = parsed.protocol === "https:" ? "https" : "http";
    const port = parsed.port.trim();
    const includePort = port.length > 0 && !isDefaultPort(protocol, port);
    return `${protocol}://${parsed.hostname}${includePort ? `:${port}` : ""}`;
  } catch {
    return null;
  }
};

// Xtream Codes server configuration from environment variable
export const XTREAM_SERVER_URL = trimTrailingSlash(import.meta.env.VITE_XTREAM_SERVER || "");

export const encodeXtreamProxyTarget = (serverUrl: string): string => (
  encodeURIComponent(trimTrailingSlash(serverUrl))
);

export const decodeXtreamProxyTargetFromPathname = (pathname: string): string | null => {
  const match = pathname.match(new RegExp(`^${XTREAM_DEV_PROXY_BASE_PATH}/([^/?#]+)`));
  if (!match?.[1]) {
    return null;
  }

  try {
    return normalizeXtreamTargetBase(decodeURIComponent(match[1])) ?? null;
  } catch {
    return null;
  }
};

export const resolveXtreamProxyMediaRequestUrl = (
  requestUrl: string,
  options: {
    runtimeOrigin?: string | null;
    fallbackTarget?: string | null;
  } = {},
): string => {
  const runtimeOrigin = trimTrailingSlash(
    options.runtimeOrigin ?? (typeof window === "undefined" ? "" : window.location.origin),
  );
  if (!runtimeOrigin) {
    return requestUrl;
  }

  let parsedRuntimeOrigin: URL;
  let parsedRequestUrl: URL;
  try {
    parsedRuntimeOrigin = new URL(runtimeOrigin);
    parsedRequestUrl = new URL(requestUrl, `${parsedRuntimeOrigin.origin}/`);
  } catch {
    return requestUrl;
  }

  if (decodeXtreamProxyTargetFromPathname(parsedRequestUrl.pathname)) {
    return parsedRequestUrl.toString();
  }

  let targetBase = normalizeXtreamTargetBase(options.fallbackTarget ?? "");
  const isHttpRequest = parsedRequestUrl.protocol === "http:" || parsedRequestUrl.protocol === "https:";

  if (!targetBase && isHttpRequest && parsedRequestUrl.origin !== parsedRuntimeOrigin.origin) {
    targetBase = normalizeXtreamTargetBase(parsedRequestUrl.origin);
  }

  if (!targetBase) {
    return parsedRequestUrl.toString();
  }

  const encodedTarget = encodeXtreamProxyTarget(targetBase);
  return `${parsedRuntimeOrigin.origin}${XTREAM_DEV_PROXY_BASE_PATH}/${trimLeadingSlash(encodedTarget)}${parsedRequestUrl.pathname}${parsedRequestUrl.search}${parsedRequestUrl.hash}`;
};

export const resolveXtreamCanonicalServer = (
  currentServerUrl: string,
  serverInfo?: Partial<XtreamServerInfo> | null,
): string => {
  const normalizedCurrent = trimTrailingSlash(currentServerUrl);
  if (!serverInfo?.url) {
    return normalizedCurrent;
  }

  let fallbackProtocol: "http" | "https" = "http";
  let fallbackPort = "";
  try {
    const parsedCurrent = new URL(normalizedCurrent);
    fallbackProtocol = resolveProtocol(parsedCurrent.protocol.replace(":", ""), "http");
    fallbackPort = parsedCurrent.port;
  } catch {
    // Keep defaults.
  }

  const parsedServerInfo = parseServerInfoHost(serverInfo.url);
  const host = parsedServerInfo.host.trim();
  if (!host) {
    return normalizedCurrent;
  }

  const protocol = resolveProtocol(
    (serverInfo.server_protocol as string | undefined) ?? parsedServerInfo.protocol,
    fallbackProtocol,
  );
  const portCandidate = (
    protocol === "https"
      ? (serverInfo.https_port || serverInfo.port || parsedServerInfo.port || fallbackPort)
      : (serverInfo.port || parsedServerInfo.port || fallbackPort)
  )?.trim() || "";
  const includePort = portCandidate.length > 0 && !isDefaultPort(protocol, portCandidate);

  return `${protocol}://${host}${includePort ? `:${portCandidate}` : ""}`;
};

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

  const encodedTarget = encodeXtreamProxyTarget(normalizedServer);
  return `${trimTrailingSlash(runtimeOrigin)}${XTREAM_DEV_PROXY_BASE_PATH}/${trimLeadingSlash(encodedTarget)}`;
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
