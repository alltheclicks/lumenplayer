import { FetchHttpClient, XtreamCodesService } from "@lumen/api";
import type { XtreamCredentials } from "@lumen/types";

const httpClient = new FetchHttpClient();
const DEV_PROXY_BASE_PATH = "/xui-api";

const resolveRuntimeCredentials = (
  credentials: XtreamCredentials,
): XtreamCredentials => {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return credentials;
  }

  return {
    ...credentials,
    server: `${window.location.origin}${DEV_PROXY_BASE_PATH}`,
  };
};

export const xtreamCodesService = new XtreamCodesService(httpClient, {
  resolveCredentials: resolveRuntimeCredentials,
});
