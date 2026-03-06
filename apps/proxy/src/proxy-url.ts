const DEFAULT_BASE_ORIGIN = "http://localhost";

export const XUI_PROXY_BASE_PATH = "/xui-api";

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

export const buildProxyUrlForAbsoluteUrl = (
  absoluteUrl: string,
  requestOrigin: string,
): string => {
  const resolved = new URL(absoluteUrl);
  const encodedTarget = encodeURIComponent(`${resolved.protocol}//${resolved.host}`);
  return new URL(
    `${XUI_PROXY_BASE_PATH}/${encodedTarget}${resolved.pathname}${resolved.search}`,
    requestOrigin,
  ).toString();
};

export const parseProxyTargetUrl = (
  value: string | URL,
): { requestUrl: URL; upstreamUrl: URL; encodedTarget: string | null } | null => {
  const requestUrl = parseUrl(value);
  if (!requestUrl) {
    return null;
  }

  const proxyMatch = requestUrl.pathname.match(/^\/xui-api\/([^/?#]+)(\/.*)?$/);
  if (!proxyMatch || !proxyMatch[1]) {
    return {
      requestUrl,
      upstreamUrl: requestUrl,
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
      encodedTarget: proxyMatch[1],
    };
  } catch {
    return null;
  }
};
