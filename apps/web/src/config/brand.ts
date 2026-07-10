const rawBrandName = (import.meta.env.VITE_BRAND_NAME ?? "").trim();

/** Full product name shown in titles and wordmarks. */
export const BRAND_NAME = rawBrandName || "Lumen Player";

/** Short form used inside sentences ("... niti do Lumen playera"). */
export const BRAND_SHORT = BRAND_NAME.replace(/\s+player$/i, "");

export interface BrandWordmark {
  prefix: string;
  accent: string;
}

/**
 * Split the brand name into a neutral prefix and an accent-colored suffix:
 * "Lumen Player" -> "Lumen " + "Player", "EXYU.tv" -> "EXYU" + ".tv".
 */
export const getBrandWordmark = (): BrandWordmark => {
  const lastSpace = BRAND_NAME.lastIndexOf(" ");
  if (lastSpace > 0) {
    return {
      prefix: BRAND_NAME.slice(0, lastSpace + 1),
      accent: BRAND_NAME.slice(lastSpace + 1),
    };
  }

  const firstDot = BRAND_NAME.indexOf(".");
  if (firstDot > 0) {
    return {
      prefix: BRAND_NAME.slice(0, firstDot),
      accent: BRAND_NAME.slice(firstDot),
    };
  }

  return { prefix: BRAND_NAME, accent: "" };
};
