import type { PlaybackError } from '@lumen/types';
import { ManifestRuntimeGateError } from '@/adapters/HlsPlayerAdapter';

const MANIFEST_CONTENT_TYPE_HINTS = [
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/mpegurl',
  'application/mpegurl',
  'application/x-mpegurl',
];

const NON_PLAYABLE_CONTENT_TYPE_HINTS = [
  'video/mp2t',
  'video/mpeg2',
  'video/mpeg',
  'text/html',
];

export type CatchUpFallbackReason =
  | 'non_playable_payload'
  | 'media_error'
  | 'timeout'
  | 'network_error'
  | 'load_failed'
  | 'playback_error';

export interface CatchUpRuntimePayloadInput {
  requestedUrl: string;
  manifestUrl: string;
  finalUrl: string | null;
  httpStatus: number | null;
  contentType: string | null;
}

export interface CatchUpRuntimeGateDecision {
  isPlayableForRuntime: boolean;
  fallbackReason: CatchUpFallbackReason | null;
  contentType: string | null;
}

export interface CatchUpRuntimePayloadProbeResult {
  finalUrl: string | null;
  httpStatus: number | null;
  contentType: string | null;
}

export interface CatchUpFallbackSignal {
  errorCode: string;
  fallbackReason: CatchUpFallbackReason;
  httpStatus: number | null;
  contentType: string | null;
  finalUrlHost: string | null;
  isPlayableForRuntime: boolean;
}

interface ParsedRuntimeErrorDetails {
  httpStatus: number | null;
  contentType: string | null;
  finalUrlHost: string | null;
  isPlayableForRuntime: boolean | null;
  fallbackReason: CatchUpFallbackReason | null;
}

const isCatchUpFallbackReason = (value: unknown): value is CatchUpFallbackReason => (
  value === 'non_playable_payload' ||
  value === 'media_error' ||
  value === 'timeout' ||
  value === 'network_error' ||
  value === 'load_failed' ||
  value === 'playback_error'
);

const parseHttpStatus = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value);
  }

  if (typeof value === 'string') {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) {
      return Math.floor(numericValue);
    }
  }

  return null;
};

const isLikelyManifestUrl = (urlValue: string | null | undefined): boolean => {
  if (!urlValue) {
    return false;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlValue);
  } catch {
    return false;
  }

  const normalizedPath = parsedUrl.pathname.toLowerCase();
  if (normalizedPath.endsWith('.m3u8')) {
    return true;
  }

  const extensionValue = parsedUrl.searchParams.get('extension')?.toLowerCase() ?? '';
  if (extensionValue === 'm3u8') {
    return true;
  }

  const formatValue = parsedUrl.searchParams.get('format')?.toLowerCase() ?? '';
  if (formatValue === 'm3u8') {
    return true;
  }

  return false;
};

export const normalizeContentType = (contentType: string | null | undefined): string | null => {
  if (!contentType) {
    return null;
  }

  const normalized = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return normalized.length > 0 ? normalized : null;
};

export const resolveUrlHost = (urlValue: string | null | undefined): string | null => {
  if (!urlValue) {
    return null;
  }

  try {
    return new URL(urlValue).host;
  } catch {
    return null;
  }
};

export const shouldApplyCatchUpRuntimeGate = (mode: unknown): boolean => mode === 'catchup';

export const resolveCatchUpFallbackReason = (errorCode: string): CatchUpFallbackReason => {
  if (errorCode === 'NON_PLAYABLE_PAYLOAD') {
    return 'non_playable_payload';
  }

  if (errorCode === 'NETWORK_TIMEOUT' || errorCode === 'LOAD_TIMEOUT') {
    return 'timeout';
  }

  if (
    errorCode === 'MEDIA_ERROR' ||
    errorCode === 'HLS_ERROR' ||
    errorCode.startsWith('MEDIA_ELEMENT_')
  ) {
    return 'media_error';
  }

  if (errorCode === 'NETWORK_ERROR') {
    return 'network_error';
  }

  if (errorCode === 'LOAD_FAILED') {
    return 'load_failed';
  }

  return 'playback_error';
};

const parseRuntimeErrorDetails = (details: unknown): ParsedRuntimeErrorDetails => {
  if (!details || typeof details !== 'object') {
    return {
      httpStatus: null,
      contentType: null,
      finalUrlHost: null,
      isPlayableForRuntime: null,
      fallbackReason: null,
    };
  }

  const parsedDetails = details as Record<string, unknown>;
  const finalUrlHostValue = typeof parsedDetails.finalUrlHost === 'string'
    ? parsedDetails.finalUrlHost
    : resolveUrlHost(
      typeof parsedDetails.finalUrl === 'string' ? parsedDetails.finalUrl : null
    );

  return {
    httpStatus: parseHttpStatus(parsedDetails.httpStatus),
    contentType: normalizeContentType(
      typeof parsedDetails.contentType === 'string' ? parsedDetails.contentType : null
    ),
    finalUrlHost: finalUrlHostValue,
    isPlayableForRuntime: typeof parsedDetails.isPlayableForRuntime === 'boolean'
      ? parsedDetails.isPlayableForRuntime
      : null,
    fallbackReason: isCatchUpFallbackReason(parsedDetails.fallbackReason)
      ? parsedDetails.fallbackReason
      : null,
  };
};

export const evaluateCatchUpRuntimePayload = (
  payload: CatchUpRuntimePayloadInput,
): CatchUpRuntimeGateDecision => {
  const normalizedContentType = normalizeContentType(payload.contentType);
  const candidateUrl = payload.finalUrl ?? payload.manifestUrl ?? payload.requestedUrl;

  if (
    typeof payload.httpStatus === 'number' &&
    Number.isFinite(payload.httpStatus) &&
    payload.httpStatus >= 400
  ) {
    return {
      isPlayableForRuntime: false,
      fallbackReason: 'network_error',
      contentType: normalizedContentType,
    };
  }

  if (normalizedContentType) {
    if (MANIFEST_CONTENT_TYPE_HINTS.some((hint) => normalizedContentType.includes(hint))) {
      return {
        isPlayableForRuntime: true,
        fallbackReason: null,
        contentType: normalizedContentType,
      };
    }

    if (NON_PLAYABLE_CONTENT_TYPE_HINTS.some((hint) => normalizedContentType.includes(hint))) {
      return {
        isPlayableForRuntime: false,
        fallbackReason: 'non_playable_payload',
        contentType: normalizedContentType,
      };
    }
  }

  if (isLikelyManifestUrl(candidateUrl)) {
    return {
      isPlayableForRuntime: true,
      fallbackReason: null,
      contentType: normalizedContentType,
    };
  }

  return {
    isPlayableForRuntime: true,
    fallbackReason: null,
    contentType: normalizedContentType,
  };
};

export const probeCatchUpRuntimePayload = async (
  requestUrl: string,
  timeoutMs = 8_000,
): Promise<CatchUpRuntimePayloadProbeResult | null> => {
  if (typeof fetch !== 'function') {
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(requestUrl, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Range: 'bytes=0-2048',
      },
    });

    try {
      await response.body?.cancel();
    } catch {
      // Ignore cancellation failures in probing mode.
    }

    return {
      finalUrl: response.url || requestUrl,
      httpStatus: response.status,
      contentType: normalizeContentType(response.headers.get('content-type')),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
    controller.abort();
  }
};

export const createCatchUpFallbackSignalFromPlaybackError = (
  playbackError: PlaybackError,
): CatchUpFallbackSignal => {
  const parsedDetails = parseRuntimeErrorDetails(playbackError.details);

  return {
    errorCode: playbackError.code,
    fallbackReason: parsedDetails.fallbackReason ?? resolveCatchUpFallbackReason(playbackError.code),
    httpStatus: parsedDetails.httpStatus,
    contentType: parsedDetails.contentType,
    finalUrlHost: parsedDetails.finalUrlHost,
    isPlayableForRuntime: parsedDetails.isPlayableForRuntime ?? false,
  };
};

export const createCatchUpFallbackSignalFromLoadError = (
  loadError: unknown,
): CatchUpFallbackSignal => {
  if (loadError instanceof ManifestRuntimeGateError) {
    const fallbackReason = isCatchUpFallbackReason(loadError.fallbackReason)
      ? loadError.fallbackReason
      : 'non_playable_payload';

    return {
      errorCode: loadError.code,
      fallbackReason,
      httpStatus: loadError.manifestEvent.httpStatus,
      contentType: normalizeContentType(loadError.manifestEvent.contentType),
      finalUrlHost: resolveUrlHost(
        loadError.manifestEvent.finalUrl ??
          loadError.manifestEvent.manifestUrl ??
          loadError.manifestEvent.requestedUrl
      ),
      isPlayableForRuntime: false,
    };
  }

  return {
    errorCode: 'LOAD_FAILED',
    fallbackReason: 'load_failed',
    httpStatus: null,
    contentType: null,
    finalUrlHost: null,
    isPlayableForRuntime: false,
  };
};
