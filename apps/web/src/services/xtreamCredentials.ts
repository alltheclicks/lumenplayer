import type { XtreamCredentials } from "@lumen/types";
import {
  clearStoredCredentials,
  loadStoredCredentials,
  saveStoredCredentials,
} from "@/services/storage";
import { xtreamCodesService } from "@/services/xtreamService";

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
