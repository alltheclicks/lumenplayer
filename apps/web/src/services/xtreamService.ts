import { FetchHttpClient, XtreamCodesService } from "@lumen/api";
import { resolveXtreamRuntimeCredentials } from "@/config/xtream";

const httpClient = new FetchHttpClient();

export const xtreamCodesService = new XtreamCodesService(httpClient, {
  resolveCredentials: resolveXtreamRuntimeCredentials,
});
