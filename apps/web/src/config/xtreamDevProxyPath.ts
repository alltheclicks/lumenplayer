const XTREAM_DEV_PROXY_BASE_PATH = "/xui-api";

interface ResolvedXtreamProxyRequest {
  target: string | null;
  rewrittenPath: string;
}

const normalizeServerTarget = (value: string): string => value.trim().replace(/\/+$/, "");

const splitPathAndQuery = (requestPath: string): { pathname: string; search: string } => {
  const queryIndex = requestPath.indexOf("?");
  if (queryIndex < 0) {
    return {
      pathname: requestPath,
      search: "",
    };
  }

  return {
    pathname: requestPath.slice(0, queryIndex),
    search: requestPath.slice(queryIndex),
  };
};

const ensureLeadingSlash = (value: string): string => value.startsWith("/") ? value : `/${value}`;

const resolveTargetFromDecodedAbsolutePath = (
  pathValue: string,
): { target: string; suffixPath: string } | null => {
  const match = pathValue.match(/^(https?:\/\/[^/?#]+)(\/.*)?$/i);
  if (!match || !match[1]) {
    return null;
  }

  return {
    target: normalizeServerTarget(match[1]),
    suffixPath: match[2] ?? "",
  };
};

const resolveTargetFromEncodedPath = (
  pathValue: string,
): { target: string; suffixPath: string } | null => {
  if (!pathValue) {
    return null;
  }

  const firstPathSeparator = pathValue.indexOf("/");
  const encodedTarget = firstPathSeparator >= 0
    ? pathValue.slice(0, firstPathSeparator)
    : pathValue;
  const suffixPath = firstPathSeparator >= 0 ? pathValue.slice(firstPathSeparator) : "";

  if (!encodedTarget) {
    return null;
  }

  let decodedTarget: string;
  try {
    decodedTarget = decodeURIComponent(encodedTarget).trim();
  } catch {
    return null;
  }

  if (!decodedTarget.startsWith("http://") && !decodedTarget.startsWith("https://")) {
    return null;
  }

  return {
    target: normalizeServerTarget(decodedTarget),
    suffixPath,
  };
};

export const resolveXtreamDevProxyRequest = (requestPath: string): ResolvedXtreamProxyRequest => {
  const { pathname, search } = splitPathAndQuery(requestPath);
  const proxyPrefix = `${XTREAM_DEV_PROXY_BASE_PATH}/`;

  if (!pathname.startsWith(proxyPrefix)) {
    return {
      target: null,
      rewrittenPath: requestPath,
    };
  }

  const remainder = pathname.slice(proxyPrefix.length);
  const decodedAbsoluteTarget = resolveTargetFromDecodedAbsolutePath(remainder);
  const encodedTarget = resolveTargetFromEncodedPath(remainder);
  const resolvedTarget = decodedAbsoluteTarget ?? encodedTarget;

  if (!resolvedTarget) {
    return {
      target: null,
      rewrittenPath: "",
    };
  }

  const rewrittenPath = ensureLeadingSlash(`${resolvedTarget.suffixPath}${search}`);
  return {
    target: resolvedTarget.target,
    rewrittenPath,
  };
};
