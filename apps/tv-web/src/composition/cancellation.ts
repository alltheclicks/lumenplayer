import { AbortController as LegacyAbortController } from "abort-controller";

/** Chrome 63 predates AbortController; retain a native implementation when present. */
export function ensureCancellation(target: { AbortController?: typeof AbortController }): void {
  if (typeof target.AbortController === "undefined") {
    target.AbortController = LegacyAbortController as typeof AbortController;
  }
}
