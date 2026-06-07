import type { XtreamCredentials } from "@lumen/types";
import {
  clearStoredCredentials,
  loadStoredCredentials,
  saveStoredCredentials,
} from "@/services/storage";
import { xtreamCodesService } from "@/services/xtreamService";
import { XTREAM_SERVER_URL, isServerConfigured } from "@/config/xtream";

export const resolveConfiguredXtreamCredentials = (
  credentials: XtreamCredentials,
): XtreamCredentials => {
  if (!isServerConfigured()) {
    return credentials;
  }

  if (credentials.server === XTREAM_SERVER_URL) {
    return credentials;
  }

  return {
    ...credentials,
    server: XTREAM_SERVER_URL,
  };
};

export const saveXtreamCredentials = async (
  credentials: XtreamCredentials,
): Promise<void> => {
  const resolvedCredentials = resolveConfiguredXtreamCredentials(credentials);
  await saveStoredCredentials(resolvedCredentials);
  xtreamCodesService.setCredentials(resolvedCredentials);
};

export const loadXtreamCredentials = async (): Promise<XtreamCredentials | null> => {
  const credentials = await loadStoredCredentials();
  if (credentials) {
    const resolvedCredentials = resolveConfiguredXtreamCredentials(credentials);
    if (resolvedCredentials !== credentials) {
      await saveStoredCredentials(resolvedCredentials);
    }
    xtreamCodesService.setCredentials(resolvedCredentials);
    return resolvedCredentials;
  }
  return null;
};

export const clearXtreamCredentials = async (): Promise<void> => {
  await clearStoredCredentials();
  xtreamCodesService.setCredentials(null);
};
