import { describe, expect, it } from "vitest";
import { BRAND_NAME, BRAND_SHORT, getBrandWordmark, HAS_CUSTOM_BRAND } from "./brand";
import { CUSTOM_BRAND_DESCRIPTION, getBrandDescription, PRODUCT_NAME } from "./productIdentity";

describe("product identity", () => {
  it("defaults the public brand to Klaro Player", () => {
    expect(HAS_CUSTOM_BRAND).toBe(false);
    expect(BRAND_NAME).toBe("Klaro Player");
    expect(BRAND_SHORT).toBe("Klaro");
    expect(getBrandWordmark()).toEqual({ prefix: "Klaro ", accent: "Player" });
  });

  it("uses the Klaro tagline and description only for the default brand", () => {
    expect(getBrandDescription(PRODUCT_NAME)).toBe(
      "One setup. Every screen. Add your source once. Your channels, favourites and progress follow you everywhere.",
    );
    expect(getBrandDescription("EXYU.tv")).toBe(CUSTOM_BRAND_DESCRIPTION);
    expect(CUSTOM_BRAND_DESCRIPTION).toBe("Watch live TV channels");
  });
});
