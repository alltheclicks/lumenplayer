const PLAYABLE_MANIFEST_CONTENT_TYPES = [
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "audio/mpegurl",
  "application/mpegurl",
];

const NON_PLAYABLE_CONTENT_TYPES = [
  "video/mp2t",
  "video/mpeg2",
  "video/mpeg",
  "text/html",
];

export type CatchUpRuntimeRejectionReason =
  | "http_error"
  | "non_playable_ts_payload";

export interface CatchUpRuntimePayloadInput {
  requestedUrl: string;
  manifestUrl: string;
  finalUrl: string | null;
  httpStatus: number | null;
  contentType: string | null;
}

export interface CatchUpRuntimeGateDecision {
  isPlayableForRuntime: boolean;
  rejectionReason: CatchUpRuntimeRejectionReason | null;
  responseContentType: string | null;
}

export const normalizeContentType = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  const normalized = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return normalized.length > 0 ? normalized : null;
};

const isLikelyManifestUrl = (value: string | null | undefined): boolean => {
  if (!value) {
    return false;
  }

  try {
    const parsed = new URL(value);
    const pathname = parsed.pathname.toLowerCase();
    if (pathname.endsWith(".m3u8")) {
      return true;
    }

    const extension = parsed.searchParams.get("extension")?.toLowerCase() ?? "";
    if (extension === "m3u8") {
      return true;
    }

    const format = parsed.searchParams.get("format")?.toLowerCase() ?? "";
    return format === "m3u8";
  } catch {
    return false;
  }
};

export const evaluateCatchUpRuntimePayload = (
  payload: CatchUpRuntimePayloadInput,
): CatchUpRuntimeGateDecision => {
  const normalizedContentType = normalizeContentType(payload.contentType);

  if (
    typeof payload.httpStatus === "number" &&
    Number.isFinite(payload.httpStatus) &&
    payload.httpStatus >= 400
  ) {
    return {
      isPlayableForRuntime: false,
      rejectionReason: "http_error",
      responseContentType: normalizedContentType,
    };
  }

  if (normalizedContentType) {
    if (PLAYABLE_MANIFEST_CONTENT_TYPES.some((hint) => normalizedContentType.includes(hint))) {
      return {
        isPlayableForRuntime: true,
        rejectionReason: null,
        responseContentType: normalizedContentType,
      };
    }

    if (NON_PLAYABLE_CONTENT_TYPES.some((hint) => normalizedContentType.includes(hint))) {
      return {
        isPlayableForRuntime: false,
        rejectionReason: "non_playable_ts_payload",
        responseContentType: normalizedContentType,
      };
    }
  }

  if (isLikelyManifestUrl(payload.finalUrl ?? payload.manifestUrl ?? payload.requestedUrl)) {
    return {
      isPlayableForRuntime: true,
      rejectionReason: null,
      responseContentType: normalizedContentType,
    };
  }

  return {
    isPlayableForRuntime: true,
    rejectionReason: null,
    responseContentType: normalizedContentType,
  };
};
