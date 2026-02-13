import { FetchHttpClient, XtreamCodesService } from "@lumen/api";

const httpClient = new FetchHttpClient();

export const xtreamCodesService = new XtreamCodesService(httpClient);
