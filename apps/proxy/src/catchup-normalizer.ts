import { randomUUID } from "node:crypto";
import {
  inspectTransportStreamSegment,
  rewriteTransportStreamContinuity,
  type PidContinuityRangeMap,
  type PidContinuityValueMap,
} from "./transport-stream.js";

const LOCAL_METADATA_PARAM_PREFIX = "__lumen";
const DEFAULT_SEGMENT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_SEGMENT_INSPECTION_CONCURRENCY = 4;
const INITIAL_SEGMENT_INSPECTION_LIMIT = 3;

export interface CatchUpRequestMetadata {
  streamId: number | null;
  programId: string | null;
  start: string | number | null;
  duration: number | null;
}

export interface ProxyLogger {
  info: (eventName: string, payload: Record<string, unknown>) => void;
  warn: (eventName: string, payload: Record<string, unknown>) => void;
  error: (eventName: string, payload: Record<string, unknown>) => void;
}

export interface NormalizedSegmentRecord extends CatchUpRequestMetadata {
  id: string;
  upstreamSegmentUrls: string[];
  previousRecordId: string | null;
  finalHost: string | null;
  segmentIndex: number;
  syncOffsetBytes: number | null;
  upstreamExtinf: number | null;
  normalizedDuration: number | null;
  continuityByPid: PidContinuityRangeMap | null;
  lastContinuityByPid: PidContinuityValueMap | null;
  createdAtMs: number;
}

export interface NormalizedManifestResponse {
  kind: "manifest";
  body: string;
  contentType: string;
  finalManifestUrl: string;
  finalHost: string | null;
  metadata: CatchUpRequestMetadata;
}

export interface NormalizedTransportStreamResponse {
  kind: "transport-stream";
  body: Buffer;
  contentType: string;
  finalUrl: string;
  finalHost: string | null;
  metadata: CatchUpRequestMetadata;
}

export interface PassthroughCatchUpResponse {
  kind: "passthrough";
  response: Response;
  finalUrl: string;
  finalHost: string | null;
  metadata: CatchUpRequestMetadata;
}

export type CatchUpNormalizedResponse =
  | NormalizedManifestResponse
  | NormalizedTransportStreamResponse
  | PassthroughCatchUpResponse;

interface ParsedManifestSegment {
  segmentIndex: number;
  uriLineIndex: number;
  uri: string;
  extinfLineIndex: number;
  upstreamExtinf: number | null;
}

interface FetchWithRedirectsResult {
  response: Response;
  finalUrl: string;
}

interface NormalizeCatchUpRequestOptions {
  upstreamUrl: URL;
  requestHeaders: Headers;
  segmentCache: NormalizedSegmentCache;
  logger: ProxyLogger;
  fetchImpl?: typeof fetch;
  segmentInspectionConcurrency?: number;
}

const parseNullableNumber = (value: string | null | undefined): number | null => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : null;
};

const parseNullableString = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseCatchUpPathMetadata = (url: URL): Partial<CatchUpRequestMetadata> => {
  const pathMatch = url.pathname.match(
    /^\/timeshift\/[^/]+\/[^/]+\/([^/]+)\/([^/]+)\/([^/.]+)\.(?:m3u8|ts)$/i,
  );
  if (pathMatch) {
    return {
      duration: parseNullableNumber(pathMatch[1]),
      start: parseNullableString(pathMatch[2]),
      streamId: parseNullableNumber(pathMatch[3]),
    };
  }

  if (url.pathname === "/streaming/timeshift.php") {
    const start = parseNullableString(url.searchParams.get("start"));
    const duration = parseNullableNumber(url.searchParams.get("duration"));
    return {
      duration,
      start,
      streamId: parseNullableNumber(url.searchParams.get("stream")),
    };
  }

  return {};
};

export const parseCatchUpRequestMetadata = (url: URL): CatchUpRequestMetadata => {
  const fromPath = parseCatchUpPathMetadata(url);
  return {
    streamId: parseNullableNumber(url.searchParams.get("__lumenStreamId")) ?? fromPath.streamId ?? null,
    programId: parseNullableString(url.searchParams.get("__lumenProgramId")),
    start: parseNullableString(url.searchParams.get("__lumenStart")) ?? fromPath.start ?? null,
    duration: parseNullableNumber(url.searchParams.get("__lumenDuration")) ?? fromPath.duration ?? null,
  };
};

const formatDurationForHls = (durationSeconds: number): string => {
  const normalized = Math.max(0.001, durationSeconds);
  return normalized.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
};

const isRedirectStatus = (statusCode: number): boolean => (
  statusCode === 301 ||
  statusCode === 302 ||
  statusCode === 303 ||
  statusCode === 307 ||
  statusCode === 308
);

const extractFinalHost = (url: string): string | null => {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};

const looksLikeHlsManifest = (body: string): boolean => body.trimStart().startsWith("#EXTM3U");

const looksLikeTransportStream = (contentType: string, buffer: Buffer): boolean => (
  contentType.includes("video/mp2t") || buffer.includes(0x47)
);

const mapWithConcurrency = async <TInput, TResult>(
  inputs: readonly TInput[],
  concurrency: number,
  mapper: (input: TInput, index: number) => Promise<TResult>,
): Promise<TResult[]> => {
  const results = new Array<TResult>(inputs.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, inputs.length));

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < inputs.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(inputs[index] as TInput, index);
    }
  }));

  return results;
};

const parseManifestSegments = (manifestBody: string): ParsedManifestSegment[] => {
  const lines = manifestBody.replace(/\r\n/g, "\n").split("\n");
  const segments: ParsedManifestSegment[] = [];
  let extinfLineIndex = -1;
  let upstreamExtinf: number | null = null;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const trimmed = lines[lineIndex]?.trim() ?? "";
    if (trimmed.startsWith("#EXTINF:")) {
      extinfLineIndex = lineIndex;
      const extinfValue = Number(trimmed.slice("#EXTINF:".length).split(",")[0]);
      upstreamExtinf = Number.isFinite(extinfValue) ? extinfValue : null;
      continue;
    }

    if (trimmed.length === 0 || trimmed.startsWith("#") || extinfLineIndex < 0) {
      continue;
    }

    segments.push({
      segmentIndex: segments.length,
      uriLineIndex: lineIndex,
      uri: trimmed,
      extinfLineIndex,
      upstreamExtinf,
    });

    extinfLineIndex = -1;
    upstreamExtinf = null;
  }

  return segments;
};

const rewriteManifest = (
  manifestBody: string,
  normalizedSegments: Array<{
    id: string;
    extinfLineIndex: number;
    uriLineIndex: number;
    normalizedDuration: number;
    skippedLineIndexes?: number[];
  }>,
): string => {
  const lines: Array<string | null> = manifestBody.replace(/\r\n/g, "\n").split("\n");
  let targetDurationLineIndex = lines.findIndex((line) => (line ?? "").startsWith("#EXT-X-TARGETDURATION:"));
  const targetDuration = Math.ceil(
    normalizedSegments.reduce((max, segment) => Math.max(max, segment.normalizedDuration), 0),
  );

  for (const segment of normalizedSegments) {
    lines[segment.extinfLineIndex] = `#EXTINF:${formatDurationForHls(segment.normalizedDuration)},`;
    lines[segment.uriLineIndex] = `/xui-api/__normalized__/segment/${segment.id}.ts`;
    for (const lineIndex of segment.skippedLineIndexes ?? []) {
      lines[lineIndex] = null;
    }
  }

  if (targetDurationLineIndex >= 0) {
    lines[targetDurationLineIndex] = `#EXT-X-TARGETDURATION:${Math.max(1, targetDuration)}`;
  } else {
    targetDurationLineIndex = lines.findIndex((line) => (line ?? "").startsWith("#EXT-X-VERSION:"));
    const insertionIndex = targetDurationLineIndex >= 0 ? targetDurationLineIndex + 1 : 1;
    lines.splice(insertionIndex, 0, `#EXT-X-TARGETDURATION:${Math.max(1, targetDuration)}`);
  }

  return lines.filter((line): line is string => line !== null).join("\n");
};

const sanitizeProxyMetadataParams = (url: URL): URL => {
  const sanitized = new URL(url.toString());
  const keysToDelete: string[] = [];
  sanitized.searchParams.forEach((_, key) => {
    if (key.startsWith(LOCAL_METADATA_PARAM_PREFIX)) {
      keysToDelete.push(key);
    }
  });

  for (const key of keysToDelete) {
    sanitized.searchParams.delete(key);
  }

  return sanitized;
};

const buildExpectedContinuityByPid = (
  continuityByPid: PidContinuityRangeMap | null,
  previousLastContinuityByPid: PidContinuityValueMap | null,
): PidContinuityValueMap => {
  if (!continuityByPid) {
    return {};
  }

  const expectedByPid: PidContinuityValueMap = {};
  for (const [pid, continuity] of Object.entries(continuityByPid)) {
    const previousLast = previousLastContinuityByPid?.[pid];
    expectedByPid[pid] = typeof previousLast === "number"
      ? (previousLast + 1) & 0x0f
      : continuity.first;
  }

  return expectedByPid;
};

export const isCatchUpRequestUrl = (url: URL): boolean => (
  /^\/timeshift\/[^/]+\/[^/]+\/[^/]+\/[^/]+\/[^/.]+\.(?:m3u8|ts)$/i.test(url.pathname) ||
  url.pathname === "/streaming/timeshift.php"
);

const fetchWithRedirects = async (
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  maxRedirects = 5,
): Promise<FetchWithRedirectsResult> => {
  let currentUrl = url;
  const visited = new Set<string>();

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    if (visited.has(currentUrl)) {
      throw new Error("Redirect loop detected while fetching catch-up manifest.");
    }
    visited.add(currentUrl);

    const response = await fetchImpl(currentUrl, {
      ...init,
      redirect: "manual",
    });

    const location = response.headers.get("location");
    if (!isRedirectStatus(response.status) || !location) {
      return {
        response,
        finalUrl: currentUrl,
      };
    }

    currentUrl = new URL(location, currentUrl).toString();
  }

  throw new Error("Too many redirects while fetching catch-up manifest.");
};

export class NormalizedSegmentCache {
  private readonly ttlMs: number;
  private readonly records = new Map<string, NormalizedSegmentRecord>();

  constructor(ttlMs = DEFAULT_SEGMENT_CACHE_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  set(
    record: Omit<NormalizedSegmentRecord, "id" | "createdAtMs">,
  ): NormalizedSegmentRecord {
    const next: NormalizedSegmentRecord = {
      ...record,
      id: randomUUID(),
      createdAtMs: Date.now(),
    };
    this.records.set(next.id, next);
    return next;
  }

  get(id: string): NormalizedSegmentRecord | null {
    const record = this.records.get(id);
    if (!record) {
      return null;
    }

    if (Date.now() - record.createdAtMs > this.ttlMs) {
      this.records.delete(id);
      return null;
    }

    return record;
  }

  update(id: string, partial: Partial<NormalizedSegmentRecord>): NormalizedSegmentRecord | null {
    const current = this.get(id);
    if (!current) {
      return null;
    }

    Object.assign(current, partial);
    return current;
  }

  sweep(): void {
    const now = Date.now();
    for (const [id, record] of this.records.entries()) {
      if (now - record.createdAtMs > this.ttlMs) {
        this.records.delete(id);
      }
    }
  }
}

export const normalizeCatchUpRequest = async ({
  upstreamUrl,
  requestHeaders,
  segmentCache,
  logger,
  fetchImpl = fetch,
  segmentInspectionConcurrency = DEFAULT_SEGMENT_INSPECTION_CONCURRENCY,
}: NormalizeCatchUpRequestOptions): Promise<CatchUpNormalizedResponse> => {
  const requestMetadata = parseCatchUpRequestMetadata(upstreamUrl);
  const sanitizedUpstreamUrl = sanitizeProxyMetadataParams(upstreamUrl);
  const { response, finalUrl } = await fetchWithRedirects(fetchImpl, sanitizedUpstreamUrl.toString(), {
    method: "GET",
    headers: requestHeaders,
  });
  const finalHost = extractFinalHost(finalUrl);

  if (!response.ok) {
    return {
      kind: "passthrough",
      response,
      finalUrl,
      finalHost,
      metadata: requestMetadata,
    };
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const responseBuffer = Buffer.from(await response.arrayBuffer());
  const responseText = responseBuffer.toString("utf8");

  if (looksLikeHlsManifest(responseText)) {
    const segments = parseManifestSegments(responseText);
    if (segments.length === 0) {
      throw new Error("Catch-up manifest did not contain any media segments.");
    }

    const eagerlyInspectedSegments = segments.slice(0, INITIAL_SEGMENT_INSPECTION_LIMIT);
    const inspectedByIndex = new Map<number, {
      syncOffsetBytes: number;
      normalizedDuration: number;
      continuityByPid: PidContinuityRangeMap;
    }>();

    await mapWithConcurrency(
      eagerlyInspectedSegments,
      segmentInspectionConcurrency,
      async (segment) => {
        const upstreamSegmentUrl = new URL(segment.uri, finalUrl).toString();
        const segmentResponse = await fetchImpl(upstreamSegmentUrl, {
          method: "GET",
          headers: requestHeaders,
        });

        if (!segmentResponse.ok) {
          logger.error("catchup.normalize_failure", {
            ...requestMetadata,
            segmentIndex: segment.segmentIndex,
            syncOffsetBytes: null,
            upstreamExtinf: segment.upstreamExtinf,
            normalizedDuration: null,
            finalHost,
            errorCode: `SEGMENT_FETCH_${segmentResponse.status}`,
          });
          throw new Error(`Segment fetch failed with status ${segmentResponse.status}.`);
        }

        const segmentBuffer = Buffer.from(await segmentResponse.arrayBuffer());
        const inspection = inspectTransportStreamSegment(segmentBuffer);
        inspectedByIndex.set(segment.segmentIndex, {
          syncOffsetBytes: inspection.syncOffsetBytes,
          normalizedDuration: inspection.normalizedDurationSeconds,
          continuityByPid: inspection.continuityByPid,
        });
        return null;
      },
    );

    let previousRecordId: string | null = null;
    const normalizedSegments = segments.map((segment) => {
      const upstreamSegmentUrl = new URL(segment.uri, finalUrl).toString();
      const inspected = inspectedByIndex.get(segment.segmentIndex);
      const next = {
        extinfLineIndex: segment.extinfLineIndex,
        uriLineIndex: segment.uriLineIndex,
        skippedLineIndexes: [] as number[],
        record: segmentCache.set({
          ...requestMetadata,
          upstreamSegmentUrls: [upstreamSegmentUrl],
          previousRecordId,
          finalHost,
          segmentIndex: segment.segmentIndex,
          syncOffsetBytes: inspected?.syncOffsetBytes ?? null,
          upstreamExtinf: segment.upstreamExtinf,
          normalizedDuration: inspected?.normalizedDuration ?? null,
          continuityByPid: inspected?.continuityByPid ?? null,
          lastContinuityByPid: null,
        }),
      };
      previousRecordId = next.record.id;
      return next;
    });

    logger.info("catchup.normalize_manifest", {
      ...requestMetadata,
      segmentIndex: null,
      syncOffsetBytes: null,
      upstreamExtinf: null,
      normalizedDuration: null,
      finalHost,
      errorCode: null,
      segmentCount: normalizedSegments.length,
      eagerlyInspectedSegments: eagerlyInspectedSegments.length,
    });

    return {
      kind: "manifest",
      body: rewriteManifest(
        responseText,
        normalizedSegments.map((segment) => ({
          id: segment.record.id,
          extinfLineIndex: segment.extinfLineIndex,
          uriLineIndex: segment.uriLineIndex,
          normalizedDuration: (
            segment.record.normalizedDuration ??
            segment.record.upstreamExtinf ??
            60
          ),
          skippedLineIndexes: segment.skippedLineIndexes,
        })),
      ),
      contentType: "application/vnd.apple.mpegurl; charset=utf-8",
      finalManifestUrl: finalUrl,
      finalHost,
      metadata: requestMetadata,
    };
  }

  if (looksLikeTransportStream(contentType, responseBuffer)) {
    const inspection = inspectTransportStreamSegment(responseBuffer);
    return {
      kind: "transport-stream",
      body: inspection.cleanedBuffer,
      contentType: "video/mp2t",
      finalUrl,
      finalHost,
      metadata: requestMetadata,
    };
  }

  return {
    kind: "passthrough",
    response: new Response(responseBuffer, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }),
    finalUrl,
    finalHost,
    metadata: requestMetadata,
  };
};

export const normalizeCachedSegment = async (
  record: NormalizedSegmentRecord,
  requestHeaders: Headers,
  segmentCache: NormalizedSegmentCache,
  logger: ProxyLogger,
  fetchImpl: typeof fetch = fetch,
): Promise<Buffer> => {
  let syncOffsetBytes = record.syncOffsetBytes;
  let normalizedDuration = record.normalizedDuration;
  let continuityByPid = record.continuityByPid;
  let previousLastContinuityByPid = record.previousRecordId
    ? segmentCache.get(record.previousRecordId)?.lastContinuityByPid ?? null
    : null;
  let lastContinuityByPid: PidContinuityValueMap | null = null;
  const cleanedBuffers: Buffer[] = [];

  for (const upstreamSegmentUrl of record.upstreamSegmentUrls) {
    const response = await fetchImpl(upstreamSegmentUrl, {
      method: "GET",
      headers: requestHeaders,
    });

    if (!response.ok) {
      logger.error("catchup.normalize_failure", {
        streamId: record.streamId,
        programId: record.programId,
        start: record.start,
        duration: record.duration,
        segmentIndex: record.segmentIndex,
        syncOffsetBytes,
        upstreamExtinf: record.upstreamExtinf,
        normalizedDuration,
        finalHost: record.finalHost,
        errorCode: `SEGMENT_FETCH_${response.status}`,
      });
      throw new Error(`Segment fetch failed with status ${response.status}.`);
    }

    const segmentBuffer = Buffer.from(await response.arrayBuffer());
    const inspection = inspectTransportStreamSegment(segmentBuffer);
    const expectedContinuityByPid = buildExpectedContinuityByPid(
      inspection.continuityByPid,
      previousLastContinuityByPid,
    );
    const rewritten = rewriteTransportStreamContinuity(
      inspection.cleanedBuffer,
      expectedContinuityByPid,
    );

    cleanedBuffers.push(rewritten.rewrittenBuffer);
    syncOffsetBytes = inspection.syncOffsetBytes;
    normalizedDuration = normalizedDuration ?? inspection.normalizedDurationSeconds;
    continuityByPid = continuityByPid ?? inspection.continuityByPid;
    previousLastContinuityByPid = rewritten.lastContinuityByPid;
    lastContinuityByPid = rewritten.lastContinuityByPid;
  }

  segmentCache.update(record.id, {
    syncOffsetBytes,
    normalizedDuration,
    continuityByPid,
    lastContinuityByPid,
  });

  logger.info("catchup.normalize_segment", {
    streamId: record.streamId,
    programId: record.programId,
    start: record.start,
    duration: record.duration,
    segmentIndex: record.segmentIndex,
    syncOffsetBytes,
    upstreamExtinf: record.upstreamExtinf,
    normalizedDuration,
    finalHost: record.finalHost,
    errorCode: null,
  });

  return Buffer.concat(cleanedBuffers);
};
