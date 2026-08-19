import { FetchHttpClient, XtreamCodesService } from "@lumen/api";
import { resolveXtreamRuntimeCredentials } from "@/config/xtream";

const httpClient = new FetchHttpClient();

export const xtreamCodesService = new XtreamCodesService(httpClient, {
  // Catalog/auth requests need the same-origin proxy because the provider does
  // not expose browser CORS. Stream URLs deliberately keep the original CDN
  // origin so video traffic never traverses the Lumen VPS.
  resolveApiCredentials: resolveXtreamRuntimeCredentials,
});
