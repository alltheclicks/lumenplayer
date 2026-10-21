const configuredName = (import.meta.env.VITE_BRAND_NAME ?? "").trim();

export const productIdentity = {
  displayName: configuredName || "Klaro Player",
  technicalNamespace: "@lumen/tv-web",
};
