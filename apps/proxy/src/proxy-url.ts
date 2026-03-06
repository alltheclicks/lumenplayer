const DEFAULT_BASE_ORIGIN = "http://localhost";

export const XUI_PROXY_BASE_PATH = "/xui-api";

export interface ParsedProxyRequest {
  requestUrl: URL;
  encodedTarget: string;
  upstreamUrl: URL;
}

export interface ParsedProxyTargetUrl {
  requestUrl: URL;
  upstreamUrl: URL;
  proxySuffixPath: string;
  encodedTarget: string | null;
}

const normalizeServerBase = (value: string): string => value.trim().replace(/\/+$/, "");

const parseUrl = (value: string | URL): URL | null => {
  try {
    return value instanceof URL
      ? new URL(value.toString())
      : new URL(value, DEFAULT_BASE_ORIGIN);
  } catch {
    return null;
  }
};

export const isProxyTargetUrl = (value: string | URL): boolean => {
  const parsed = parseUrl(value);
  return Boolean(parsed?.pathname.startsWith(`${XUI_PROXY_BASE_PATH}/`));
};

export const buildProxyPathForAbsoluteUrl = (absoluteUrl: string): string => {
  const resolved = new URL(absoluteUrl);
  const encodedTarget = encodeURIComponent(`${resolved.protocol}//${resolved.host}`);
  return `${XUI_PROXY_BASE_PATH}/${encodedTarget}${resolved.pathname}${resolved.search}`;
};

export const buildProxyUrlForAbsoluteUrl = (
  absoluteUrl: string,
  requestOrigin: string,
): string => new URL(buildProxyPathForAbsoluteUrl(absoluteUrl), requestOrigin).toString();

export const parseProxyRequest = (requestUrl: URL): ParsedProxyRequest | null => {
  const match = requestUrl.pathname.match(/^\/xui-api\/([^/?#]+)(\/.*)?$/);
  if (!match || !match[1]) {
    return null;
  }

  let decodedTarget = "";
  try {
    decodedTarget = decodeURIComponent(match[1]).trim().replace(/\/+$/, "");
  } catch {
    return null;
  }

  if (!decodedTarget) {
    return null;
  }

  try {
    const upstreamUrl = new URL(`${decodedTarget}${match[2] && match[2].length > 0 ? match[2] : "/"}`);
    upstreamUrl.search = requestUrl.search;
    return {
      requestUrl,
      encodedTarget: match[1],
      upstreamUrl,
    };
  } catch {
    return null;
  }
};

export const parseProxyTargetUrl = (value: string | URL): ParsedProxyTargetUrl | null => {
  const requestUrl = parseUrl(value);
  if (!requestUrl) {
    return null;
  }

  const proxyMatch = requestUrl.pathname.match(/^\/xui-api\/([^/?#]+)(\/.*)?$/);
  if (!proxyMatch || !proxyMatch[1]) {
    return {
      requestUrl,
      upstreamUrl: requestUrl,
      proxySuffixPath: "",
      encodedTarget: null,
    };
  }

  let decodedTarget = "";
  try {
    decodedTarget = decodeURIComponent(proxyMatch[1]).trim();
  } catch {
    return null;
  }

  if (!decodedTarget) {
    return null;
  }

  try {
    const upstreamBase = new URL(
      decodedTarget.includes("://") ? decodedTarget : `http://${decodedTarget}`,
    );
    const upstreamUrl = new URL(
      `${normalizeServerBase(upstreamBase.toString())}${proxyMatch[2] ?? "/"}`,
    );
    upstreamUrl.search = requestUrl.search;

    return {
      requestUrl,
      upstreamUrl,
      proxySuffixPath: proxyMatch[2] ?? "",
      encodedTarget: proxyMatch[1],
    };
  } catch {
    return null;
  }
};
