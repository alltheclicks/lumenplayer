// Xtream Codes server configuration from environment variable
export const XTREAM_SERVER_URL = import.meta.env.VITE_XTREAM_SERVER || "";

export const isServerConfigured = (): boolean => {
  return XTREAM_SERVER_URL.length > 0 && !XTREAM_SERVER_URL.includes("your-server");
};

export const getServerDisplayName = (): string => {
  if (!isServerConfigured()) return "Nije konfigurisan";
  try {
    const url = new URL(XTREAM_SERVER_URL);
    return url.hostname;
  } catch {
    return "Konfigurisan";
  }
};
