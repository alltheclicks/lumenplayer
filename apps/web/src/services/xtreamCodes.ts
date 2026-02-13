// Thin wrapper around @lumen/api + @lumen/storage, maintains singleton for backward compat
import { XtreamCodesService as _XtreamCodesService, FetchHttpClient } from "@lumen/api";
import type { XtreamCredentials } from "@lumen/types";
import {
  clearStoredCredentials,
  loadStoredCredentials,
  saveStoredCredentials,
} from "@/services/storage";

// Re-export all types for backward compat
export type {
  XtreamCredentials,
  XtreamUserInfo,
  XtreamServerInfo,
  XtreamCategory,
  XtreamLiveStream,
  XtreamVOD,
  XtreamSeries,
  XtreamEPGItem,
  XtreamApiResponse,
} from "@lumen/types";

// Re-export class
export { XtreamCodesService } from "@lumen/api";

// Singleton instance (backward compat)
const httpClient = new FetchHttpClient();
export const xtreamCodesService = new _XtreamCodesService(httpClient);

// Wrapper helpers that also sync credentials to the singleton
export const saveXtreamCredentials = async (
  credentials: XtreamCredentials,
): Promise<void> => {
  await saveStoredCredentials(credentials);
  xtreamCodesService.setCredentials(credentials);
};

export const loadXtreamCredentials = async (): Promise<XtreamCredentials | null> => {
  const credentials = await loadStoredCredentials();
  if (credentials) {
    xtreamCodesService.setCredentials(credentials);
  }
  return credentials;
};

export const clearXtreamCredentials = async (): Promise<void> => {
  await clearStoredCredentials();
  xtreamCodesService.setCredentials(null);
};
