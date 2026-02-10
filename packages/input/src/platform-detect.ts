export type Platform = "tizen" | "webos" | "web";

declare const tizen: unknown;
declare const webOS: unknown;

export const detectPlatform = (): Platform => {
  if (typeof tizen !== "undefined") return "tizen";
  if (typeof webOS !== "undefined") return "webos";
  return "web";
};
