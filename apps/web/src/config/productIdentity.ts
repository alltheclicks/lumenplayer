/**
 * Default public product identity (Klaro Player).
 *
 * Kept free of `import.meta.env` so both the app (`brand.ts`) and the Node-side
 * `vite.config.ts` can import it. Internal identifiers (package names, storage
 * keys, env vars, Cast namespace) intentionally keep the legacy `lumen` code name.
 */
export const PRODUCT_NAME = "Klaro Player";

export const PRODUCT_TAGLINE = "One setup. Every screen.";

export const PRODUCT_DESCRIPTION =
  "Add your source once. Your channels, favourites and progress follow you everywhere.";

/** Neutral description kept for customer-branded builds (e.g. VITE_BRAND_NAME=EXYU.tv). */
export const CUSTOM_BRAND_DESCRIPTION = "Watch live TV channels";

/** Meta/manifest description for a given brand name. */
export const getBrandDescription = (brandName: string): string =>
  brandName === PRODUCT_NAME
    ? `${PRODUCT_TAGLINE} ${PRODUCT_DESCRIPTION}`
    : CUSTOM_BRAND_DESCRIPTION;
