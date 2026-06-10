export interface SegmentLoadDiagnostics {
  fragmentInFlight: boolean;
  lastFragmentLoadStartedAt: number | null;
  lastFragmentLoadedAt: number | null;
}

// True when a catch-up segment is still legitimately downloading, so the
// startup watchdog should keep waiting instead of reseeking on top of it.
// Distinguishes "slow first segment in flight" from "no segment will ever come":
// a slow CDN first-segment fetch keeps fragmentInFlight true (or started very
// recently), whereas a genuinely stalled load has neither.
export const catchUpFirstSegmentLikelyInFlight = (
  diagnostics: SegmentLoadDiagnostics | null | undefined,
  graceMs: number,
  nowMs = Date.now(),
): boolean => {
  if (!diagnostics) {
    return false;
  }
  if (diagnostics.fragmentInFlight) {
    return true;
  }
  const startedAt = diagnostics.lastFragmentLoadStartedAt;
  if (startedAt === null || !Number.isFinite(startedAt)) {
    return false;
  }
  // A fragment that started but has not finished within the grace window is
  // either still arriving (slow edge) or just landed — keep waiting either way.
  const loadedAt = diagnostics.lastFragmentLoadedAt;
  const settledAfterStart = loadedAt !== null && Number.isFinite(loadedAt) && loadedAt >= startedAt;
  if (settledAfterStart) {
    return false;
  }
  return nowMs - startedAt <= Math.max(0, graceMs);
};
