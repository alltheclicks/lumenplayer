import type { XtreamCredentials } from "@lumen/types";

const CREDENTIALS_KEY = "xtream_credentials";

export const saveCredentials = (credentials: XtreamCredentials): void => {
  localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(credentials));
};

export const loadCredentials = (): XtreamCredentials | null => {
  const stored = localStorage.getItem(CREDENTIALS_KEY);
  if (!stored) return null;
  return JSON.parse(stored) as XtreamCredentials;
};

export const clearCredentials = (): void => {
  localStorage.removeItem(CREDENTIALS_KEY);
};
