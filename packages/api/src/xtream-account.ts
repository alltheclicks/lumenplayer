import type { XtreamUserInfo } from "@lumen/types";

export const isXtreamAccountActive = (
  userInfo: Partial<XtreamUserInfo> | null | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean => {
  if (userInfo?.auth !== 1) {
    return false;
  }

  const status = userInfo.status?.trim().toLowerCase() ?? "";
  if (status && status !== "active") {
    return false;
  }

  const expiresAt = Number(userInfo.exp_date ?? 0);
  return !Number.isFinite(expiresAt) || expiresAt <= 0 || expiresAt > nowSeconds;
};
