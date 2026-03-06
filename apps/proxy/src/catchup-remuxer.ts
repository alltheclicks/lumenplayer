import { randomUUID } from "node:crypto";
import muxjs, { type Mp4TransmuxedSegment, type Mp4Transmuxer } from "mux.js";
import {
  parseCatchUpRequestMetadata,
  type CatchUpRequestMetadata,
  type ProxyLogger,
} from "./catchup-normalizer.js";
import {
  inspectTransportStreamSegment,
  rewriteTransportStreamContinuity,
  type PidContinuityRangeMap,
  type PidContinuityValueMap,
} from "./transport-stream.js";

const REMUX_TRANSPORT_HINT_PARAM = "__lumenTransport";
const REMUX_FALLBACK_REASON_PARAM = "__lumenFallbackReason";
const REMUX_TRANSPORT_HINT = "remux-hls";
const DEFAULT_REMUX_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const REMUX_PREWARM_SEGMENT_COUNT = 2;
const REMUX_EAGER_DURATION_SEGMENT_COUNT = 3;
const REMUX_BASE_PATH = "/xui-api/__remux__/session";
const REMUX_INIT_PATH_PATTERN = /^\/xui-api\/__remux__\/session\/([^/]+)\/init\.mp4$/i;
const REMUX_SEGMENT_PATH_PATTERN = /^\/xui-api\/__remux__\/session\/([^/]+)\/segment\/(\d+)\.m4s$/i;

interface ParsedManifestSegment {
  segmentIndex: number;
  uri: string;
  upstreamExtinf: number | null;
}

interface FetchWithRedirectsResult {
  response: Response;
  finalUrl: string;
}

interface RemuxFeatureGate {
  enabled: boolean;
  streamIds: Set<number> | null;
  programIds: Set<string> | null;
  hosts: Set<string> | null;
}

export interface CatchUpRemuxManifestResponse {
  body: string;
  contentType: string;
  finalManifestUrl: string;
  finalHost: string | null;
  metadata: CatchUpRequestMetadata;
}

interface RemuxSourceSegment {
  segmentIndex: number;
  upstreamUrl: string;
  durationSeconds: number;
}

interface RemuxOutputSegment {
  outputSegmentIndex: number;
  sourceSegmentIndices: number[];
}

interface CatchUpRemuxSessionRecord {
  id: string;
  requestKey: string;
  metadata: CatchUpRequestMetadata;
  finalHost: string | null;
  fallbackReason: string | null;
  requestHeaders: Array<[string, string]>;
  sourceSegments: RemuxSourceSegment[];
  outputSegments: RemuxOutputSegment[];
  createdAtMs: number;
  initSegment: Buffer | null;
  mediaSegments: Map<number, Buffer>;
  normalizedSourceDurationsByIndex: Map<number, number>;
  nextVideoBaseMediaDecodeTime: number;
  nextUnprocessedOutputSegmentIndex: number;
  processingBarrier: Promise<void>;
  processingFailure: Error | null;
  lastContinuityByPid: PidContinuityValueMap | null;
}

const parseNumericFilter = (value: string | undefined): Set<number> | null => {
  if (!value) {
    return null;
  }

  const parsed = value
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry) && entry > 0)
    .map((entry) => Math.floor(entry));

  return parsed.length > 0 ? new Set(parsed) : null;
};

const parseStringFilter = (value: string | undefined): Set<string> | null => {
  if (!value) {
    return null;
  }

  const parsed = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);

  return parsed.length > 0 ? new Set(parsed) : null;
};

export const createCatchUpRemuxFeatureGate = (
  env: NodeJS.ProcessEnv = process.env,
): RemuxFeatureGate => ({
  enabled: env.LUMEN_PROXY_REMUX_ENABLED === "1",
  streamIds: parseNumericFilter(env.LUMEN_PROXY_REMUX_STREAM_IDS),
  programIds: parseStringFilter(env.LUMEN_PROXY_REMUX_PROGRAM_IDS),
  hosts: parseStringFilter(env.LUMEN_PROXY_REMUX_HOSTS),
});

const matchesOptionalFilter = <T>(
  filter: Set<T> | null,
  value: T | null,
): boolean => filter === null || (value !== null && filter.has(value));

const isRedirectStatus = (statusCode: number): boolean => (
  statusCode === 301 ||
  statusCode === 302 ||
  statusCode === 303 ||
  statusCode === 307 ||
  statusCode === 308
);

const formatDurationForHls = (durationSeconds: number): string => {
  const normalized = Math.max(0.001, durationSeconds);
  return normalized.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
};

const parseFallbackReason = (url: URL): string | null => {
  const fallbackReason = url.searchParams.get(REMUX_FALLBACK_REASON_PARAM);
  if (typeof fallbackReason !== "string") {
    return null;
  }

  const trimmed = fallbackReason.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const sanitizeLocalParams = (url: URL): URL => {
  const sanitized = new URL(url.toString());
  const keysToDelete: string[] = [];
  sanitized.searchParams.forEach((_, key) => {
    if (key.startsWith("__lumen")) {
      keysToDelete.push(key);
    }
  });

  for (const key of keysToDelete) {
    sanitized.searchParams.delete(key);
  }

  return sanitized;
};

const extractFinalHost = (url: string): string | null => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
};

const parseManifestSegments = (manifestBody: string): ParsedManifestSegment[] => {
  const lines = manifestBody.replace(/\r\n/g, "\n").split("\n");
  const segments: ParsedManifestSegment[] = [];
  let upstreamExtinf: number | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#EXTINF:")) {
      const extinfValue = Number(trimmed.slice("#EXTINF:".length).split(",")[0]);
      upstreamExtinf = Number.isFinite(extinfValue) ? extinfValue : null;
      continue;
    }

    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    segments.push({
      segmentIndex: segments.length,
      uri: trimmed,
      upstreamExtinf,
    });
    upstreamExtinf = null;
  }

  return segments;
};

const looksLikeHlsManifest = (body: string): boolean => body.trimStart().startsWith("#EXTM3U");

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
      throw new Error("Redirect loop detected while fetching remux catch-up manifest.");
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

  throw new Error("Too many redirects while fetching remux catch-up manifest.");
};

const buildExpectedContinuityByPid = (
  continuityByPid: PidContinuityRangeMap,
  previousLastContinuityByPid: PidContinuityValueMap | null,
): PidContinuityValueMap => {
  const expectedByPid: PidContinuityValueMap = {};

  for (const [pid, continuity] of Object.entries(continuityByPid)) {
    const previousLast = previousLastContinuityByPid?.[pid];
    expectedByPid[pid] = typeof previousLast === "number"
      ? (previousLast + 1) & 0x0f
      : continuity.first;
  }

  return expectedByPid;
};

const toUint8Array = (buffer: Buffer): Uint8Array => new Uint8Array(
  buffer.buffer,
  buffer.byteOffset,
  buffer.byteLength,
);

const waitForTransmuxedSegments = (
  transmuxer: Mp4Transmuxer,
  cleanedBuffers: readonly Buffer[],
): Promise<{
  initSegment: Buffer | null;
  mediaSegment: Buffer;
}> => new Promise((resolve, reject) => {
  const mediaSegmentParts: Buffer[] = [];
  let initSegment: Buffer | null = null;

  const handleData = (segment: Mp4TransmuxedSegment) => {
    if (!initSegment && segment.initSegment && segment.initSegment.byteLength > 0) {
      initSegment = Buffer.from(segment.initSegment);
    }

    if (segment.data && segment.data.byteLength > 0) {
      mediaSegmentParts.push(Buffer.from(segment.data));
    }
  };

  const handleDone = () => {
    cleanup();

    const mediaSegment = Buffer.concat(mediaSegmentParts);
    if (mediaSegment.byteLength === 0) {
      reject(new Error("Transmuxer produced an empty media segment."));
      return;
    }

    resolve({
      initSegment,
      mediaSegment,
    });
  };

  const handleError = (error: unknown) => {
    cleanup();
    reject(error instanceof Error ? error : new Error(String(error)));
  };

  const cleanup = () => {
    transmuxer.off("data", handleData);
    transmuxer.off("done", handleDone);
    transmuxer.off("error", handleError);
  };

  transmuxer.on("data", handleData);
  transmuxer.on("done", handleDone);
  transmuxer.on("error", handleError);

  try {
    for (const cleanedBuffer of cleanedBuffers) {
      transmuxer.push(toUint8Array(cleanedBuffer));
    }
    transmuxer.flush();
  } catch (error) {
    cleanup();
    reject(error instanceof Error ? error : new Error(String(error)));
  }
});

const buildRequestKey = (sanitizedUpstreamUrl: URL): string => sanitizedUpstreamUrl.toString();

const buildOutputSegments = (
  sourceSegments: RemuxSourceSegment[],
): RemuxOutputSegment[] => sourceSegments.map((segment, outputSegmentIndex) => ({
    outputSegmentIndex,
    sourceSegmentIndices: [segment.segmentIndex],
  }));

const resolveOutputSegmentDurationSeconds = (
  session: CatchUpRemuxSessionRecord,
  outputSegment: RemuxOutputSegment,
): number => outputSegment.sourceSegmentIndices.reduce((sum, sourceSegmentIndex) => {
  const sourceSegment = session.sourceSegments[sourceSegmentIndex];
  if (!sourceSegment) {
    return sum;
  }

  return (
    sum +
    (
      session.normalizedSourceDurationsByIndex.get(sourceSegmentIndex)
      ?? sourceSegment.durationSeconds
    )
  );
}, 0);

const toNumber = (value: number | bigint | null | undefined): number | null => {
  if (typeof value === "bigint") {
    return Number(value);
  }

  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const resolveNextVideoBaseMediaDecodeTime = (
  initSegment: Buffer,
  mediaSegment: Buffer,
): number => {
  const initBytes = new Uint8Array(initSegment);
  const videoTrack = muxjs.mp4.probe.tracks(initBytes).find((track) => track.type === "video");
  if (!videoTrack || typeof videoTrack.id !== "number") {
    throw new Error("Remux output is missing a video track.");
  }

  const boxes = muxjs.mp4.tools.inspect(new Uint8Array(mediaSegment));
  let maxVideoDecodeEnd = 0;

  for (const box of boxes) {
    if (box.type !== "moof") {
      continue;
    }

    const trafBoxes = box.boxes?.filter((child) => child.type === "traf") ?? [];
    for (const traf of trafBoxes) {
      const tfhd = traf.boxes?.find((child) => child.type === "tfhd");
      const tfdt = traf.boxes?.find((child) => child.type === "tfdt");
      const trun = traf.boxes?.find((child) => child.type === "trun");
      if (!tfhd || !tfdt || !trun || !trun.samples || tfhd.trackId !== videoTrack.id) {
        continue;
      }

      const baseMediaDecodeTime = toNumber(tfdt.baseMediaDecodeTime);
      if (baseMediaDecodeTime === null) {
        continue;
      }

      const decodeDuration = trun.samples.reduce(
        (sum, sample) => sum + (sample.duration ?? 0),
        0,
      );
      maxVideoDecodeEnd = Math.max(maxVideoDecodeEnd, baseMediaDecodeTime + decodeDuration);
    }
  }

  if (maxVideoDecodeEnd <= 0) {
    throw new Error("Unable to resolve the next video decode time for remux output.");
  }

  return maxVideoDecodeEnd;
};

const buildRemuxManifestBody = (
  session: CatchUpRemuxSessionRecord,
): string => {
  const targetDuration = Math.max(
    1,
    Math.ceil(
      session.outputSegments.reduce(
        (max, outputSegment) => Math.max(
          max,
          resolveOutputSegmentDurationSeconds(session, outputSegment),
        ),
        0,
      ),
    ),
  );

  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    "#EXT-X-INDEPENDENT-SEGMENTS",
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    `#EXT-X-MAP:URI="${REMUX_BASE_PATH}/${session.id}/init.mp4"`,
  ];

  for (const outputSegment of session.outputSegments) {
    const durationSeconds = resolveOutputSegmentDurationSeconds(session, outputSegment);
    lines.push(`#EXTINF:${formatDurationForHls(durationSeconds)},`);
    lines.push(`${REMUX_BASE_PATH}/${session.id}/segment/${outputSegment.outputSegmentIndex}.m4s`);
  }

  lines.push("#EXT-X-ENDLIST");
  return lines.join("\n");
};

const cloneHeaders = (headers: Headers): Array<[string, string]> => Array.from(headers.entries());

const rehydrateHeaders = (entries: Array<[string, string]>): Headers => {
  const headers = new Headers();
  for (const [name, value] of entries) {
    headers.append(name, value);
  }
  return headers;
};

export class CatchUpRemuxSessionCache {
  private readonly ttlMs: number;
  private readonly records = new Map<string, CatchUpRemuxSessionRecord>();
  private readonly requestKeys = new Map<string, string>();

  constructor(ttlMs = DEFAULT_REMUX_SESSION_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  get(id: string): CatchUpRemuxSessionRecord | null {
    const record = this.records.get(id);
    if (!record) {
      return null;
    }

    if (Date.now() - record.createdAtMs > this.ttlMs) {
      this.delete(record.id);
      return null;
    }

    return record;
  }

  getByRequestKey(requestKey: string): CatchUpRemuxSessionRecord | null {
    const existingId = this.requestKeys.get(requestKey);
    if (!existingId) {
      return null;
    }

    return this.get(existingId);
  }

  set(record: Omit<CatchUpRemuxSessionRecord, "id" | "createdAtMs">): CatchUpRemuxSessionRecord {
    const next: CatchUpRemuxSessionRecord = {
      ...record,
      id: randomUUID(),
      createdAtMs: Date.now(),
    };
    this.records.set(next.id, next);
    this.requestKeys.set(next.requestKey, next.id);
    return next;
  }

  sweep(): void {
    const now = Date.now();
    for (const [id, record] of this.records.entries()) {
      if (now - record.createdAtMs > this.ttlMs) {
        this.delete(id);
      }
    }
  }

  private delete(id: string): void {
    const existing = this.records.get(id);
    if (!existing) {
      return;
    }

    this.requestKeys.delete(existing.requestKey);
    this.records.delete(id);
  }
}

const queueSegmentProcessing = async (
  session: CatchUpRemuxSessionRecord,
  targetOutputSegmentIndex: number,
  logger: ProxyLogger,
  fetchImpl: typeof fetch,
): Promise<void> => {
  const run = session.processingBarrier.then(async () => {
    if (session.processingFailure) {
      throw session.processingFailure;
    }

    while (
      session.nextUnprocessedOutputSegmentIndex <= targetOutputSegmentIndex &&
      session.nextUnprocessedOutputSegmentIndex < session.outputSegments.length
    ) {
      const outputSegment = session.outputSegments[session.nextUnprocessedOutputSegmentIndex];
      if (!outputSegment) {
        break;
      }

      const cleanedSourceBuffers: Buffer[] = [];
      let normalizedOutputDurationSeconds = 0;

      for (const sourceSegmentIndex of outputSegment.sourceSegmentIndices) {
        const sourceSegment = session.sourceSegments[sourceSegmentIndex];
        if (!sourceSegment) {
          throw new Error(`Remux source segment ${sourceSegmentIndex} is unavailable.`);
        }

        const segmentResponse = await fetchImpl(sourceSegment.upstreamUrl, {
          method: "GET",
          headers: rehydrateHeaders(session.requestHeaders),
        });

        if (!segmentResponse.ok) {
          throw new Error(`Remux segment fetch failed with status ${segmentResponse.status}.`);
        }

        const segmentBuffer = Buffer.from(await segmentResponse.arrayBuffer());
        const inspection = inspectTransportStreamSegment(segmentBuffer);
        const rewritten = rewriteTransportStreamContinuity(
          inspection.cleanedBuffer,
          buildExpectedContinuityByPid(
            inspection.continuityByPid,
            session.lastContinuityByPid,
          ),
        );

        session.normalizedSourceDurationsByIndex.set(
          sourceSegment.segmentIndex,
          inspection.normalizedDurationSeconds,
        );
        session.lastContinuityByPid = rewritten.lastContinuityByPid;
        normalizedOutputDurationSeconds += inspection.normalizedDurationSeconds;
        cleanedSourceBuffers.push(rewritten.rewrittenBuffer);
      }

      const transmuxer = new muxjs.mp4.Transmuxer({
        keepOriginalTimestamps: false,
        remux: true,
        baseMediaDecodeTime: session.nextVideoBaseMediaDecodeTime,
      });
      const transmuxed = await waitForTransmuxedSegments(transmuxer, cleanedSourceBuffers);

      if (!session.initSegment && transmuxed.initSegment) {
        session.initSegment = transmuxed.initSegment;
      }
      if (!session.initSegment) {
        throw new Error("Remux init segment was not produced.");
      }

      session.nextVideoBaseMediaDecodeTime = resolveNextVideoBaseMediaDecodeTime(
        session.initSegment,
        transmuxed.mediaSegment,
      );
      session.mediaSegments.set(outputSegment.outputSegmentIndex, transmuxed.mediaSegment);
      session.nextUnprocessedOutputSegmentIndex += 1;

      logger.info("catchup.remux_segment", {
        streamId: session.metadata.streamId,
        programId: session.metadata.programId,
        start: session.metadata.start,
        duration: session.metadata.duration,
        finalHost: session.finalHost,
        fallbackReason: session.fallbackReason,
        sessionId: session.id,
        outputSegmentIndex: outputSegment.outputSegmentIndex,
        sourceSegmentIndices: outputSegment.sourceSegmentIndices,
        normalizedDuration: normalizedOutputDurationSeconds,
        initSegmentBytes: session.initSegment.byteLength,
        mediaSegmentBytes: transmuxed.mediaSegment.byteLength,
      });
    }
  }).catch((error) => {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    session.processingFailure = normalizedError;
    logger.error("catchup.remux_failure", {
      streamId: session.metadata.streamId,
      programId: session.metadata.programId,
      start: session.metadata.start,
        duration: session.metadata.duration,
        finalHost: session.finalHost,
        fallbackReason: session.fallbackReason,
        sessionId: session.id,
        outputSegmentIndex: session.nextUnprocessedOutputSegmentIndex,
        errorCode: "REMUX_SEGMENT_FAILURE",
        message: normalizedError.message,
      });
    throw normalizedError;
  });

  session.processingBarrier = run.then(() => undefined, () => undefined);
  return run;
};

const prewarmSession = (
  session: CatchUpRemuxSessionRecord,
  logger: ProxyLogger,
  fetchImpl: typeof fetch,
): void => {
  const targetIndex = Math.min(
    session.outputSegments.length - 1,
    Math.max(0, REMUX_PREWARM_SEGMENT_COUNT - 1),
  );
  void queueSegmentProcessing(session, targetIndex, logger, fetchImpl).catch(() => {});
};

const inspectInitialSegmentDurations = async (
  session: CatchUpRemuxSessionRecord,
  logger: ProxyLogger,
  fetchImpl: typeof fetch,
): Promise<void> => {
  const eagerlyInspectedSegments = session.sourceSegments.slice(0, REMUX_EAGER_DURATION_SEGMENT_COUNT);

  await Promise.all(eagerlyInspectedSegments.map(async (segment) => {
    const response = await fetchImpl(segment.upstreamUrl, {
      method: "GET",
      headers: rehydrateHeaders(session.requestHeaders),
    });

    if (!response.ok) {
      throw new Error(`Remux duration probe failed with status ${response.status}.`);
    }

    const inspection = inspectTransportStreamSegment(Buffer.from(await response.arrayBuffer()));
    session.normalizedSourceDurationsByIndex.set(segment.segmentIndex, inspection.normalizedDurationSeconds);

    logger.info("catchup.remux_duration_probe", {
      streamId: session.metadata.streamId,
      programId: session.metadata.programId,
      start: session.metadata.start,
      duration: session.metadata.duration,
      finalHost: session.finalHost,
      fallbackReason: session.fallbackReason,
      sessionId: session.id,
      segmentIndex: segment.segmentIndex,
      normalizedDuration: inspection.normalizedDurationSeconds,
    });
  }));
};

export const shouldUseCatchUpRemux = (
  upstreamUrl: URL,
  featureGate: RemuxFeatureGate,
): boolean => {
  if (!featureGate.enabled) {
    return false;
  }

  if (upstreamUrl.searchParams.get(REMUX_TRANSPORT_HINT_PARAM) !== REMUX_TRANSPORT_HINT) {
    return false;
  }

  const metadata = parseCatchUpRequestMetadata(upstreamUrl);
  const upstreamHost = upstreamUrl.host.trim().toLowerCase() || null;

  return (
    matchesOptionalFilter(featureGate.streamIds, metadata.streamId) &&
    matchesOptionalFilter(
      featureGate.programIds,
      metadata.programId ? metadata.programId.trim().toLowerCase() : null,
    ) &&
    matchesOptionalFilter(featureGate.hosts, upstreamHost)
  );
};

export const createRemuxedCatchUpManifest = async ({
  upstreamUrl,
  requestHeaders,
  sessionCache,
  logger,
  fetchImpl = fetch,
}: {
  upstreamUrl: URL;
  requestHeaders: Headers;
  sessionCache: CatchUpRemuxSessionCache;
  logger: ProxyLogger;
  fetchImpl?: typeof fetch;
}): Promise<CatchUpRemuxManifestResponse> => {
  const metadata = parseCatchUpRequestMetadata(upstreamUrl);
  const fallbackReason = parseFallbackReason(upstreamUrl);
  const sanitizedUpstreamUrl = sanitizeLocalParams(upstreamUrl);
  const requestKey = buildRequestKey(sanitizedUpstreamUrl);
  const existingSession = sessionCache.getByRequestKey(requestKey);

  if (existingSession) {
    return {
      body: buildRemuxManifestBody(existingSession),
      contentType: "application/vnd.apple.mpegurl; charset=utf-8",
      finalManifestUrl: sanitizedUpstreamUrl.toString(),
      finalHost: existingSession.finalHost,
      metadata,
    };
  }

  const { response, finalUrl } = await fetchWithRedirects(fetchImpl, sanitizedUpstreamUrl.toString(), {
    method: "GET",
    headers: requestHeaders,
  });

  if (!response.ok) {
    throw new Error(`Remux manifest fetch failed with status ${response.status}.`);
  }

  const responseBuffer = Buffer.from(await response.arrayBuffer());
  const responseText = responseBuffer.toString("utf8");
  if (!looksLikeHlsManifest(responseText)) {
    throw new Error("Remux fallback requires an HLS catch-up manifest.");
  }

  const manifestSegments = parseManifestSegments(responseText);
  if (manifestSegments.length === 0) {
    throw new Error("Remux fallback received an empty catch-up manifest.");
  }

  const sourceSegments = manifestSegments.map((segment) => ({
    segmentIndex: segment.segmentIndex,
    upstreamUrl: new URL(segment.uri, finalUrl).toString(),
    durationSeconds: segment.upstreamExtinf ?? 60,
  }));

  const session = sessionCache.set({
    requestKey,
    metadata,
    finalHost: extractFinalHost(finalUrl),
    fallbackReason,
    requestHeaders: cloneHeaders(requestHeaders),
    sourceSegments,
    outputSegments: buildOutputSegments(sourceSegments),
    initSegment: null,
    mediaSegments: new Map<number, Buffer>(),
    normalizedSourceDurationsByIndex: new Map<number, number>(),
    nextVideoBaseMediaDecodeTime: 0,
    nextUnprocessedOutputSegmentIndex: 0,
    processingBarrier: Promise.resolve(),
    processingFailure: null,
    lastContinuityByPid: null,
  });

  logger.info("catchup.remux_manifest", {
    streamId: metadata.streamId,
    programId: metadata.programId,
    start: metadata.start,
    duration: metadata.duration,
    finalHost: session.finalHost,
    fallbackReason,
    sessionId: session.id,
    sourceSegmentCount: session.sourceSegments.length,
    outputSegmentCount: session.outputSegments.length,
  });

  await inspectInitialSegmentDurations(session, logger, fetchImpl);
  prewarmSession(session, logger, fetchImpl);

  return {
    body: buildRemuxManifestBody(session),
    contentType: "application/vnd.apple.mpegurl; charset=utf-8",
    finalManifestUrl: finalUrl,
    finalHost: session.finalHost,
    metadata,
  };
};

export const parseCatchUpRemuxAssetRequest = (
  requestUrl: URL,
): {
  sessionId: string;
  kind: "init" | "segment";
  segmentIndex: number | null;
} | null => {
  const initMatch = requestUrl.pathname.match(REMUX_INIT_PATH_PATTERN);
  if (initMatch?.[1]) {
    return {
      sessionId: initMatch[1],
      kind: "init",
      segmentIndex: null,
    };
  }

  const segmentMatch = requestUrl.pathname.match(REMUX_SEGMENT_PATH_PATTERN);
  if (segmentMatch?.[1] && segmentMatch[2]) {
    return {
      sessionId: segmentMatch[1],
      kind: "segment",
      segmentIndex: Number(segmentMatch[2]),
    };
  }

  return null;
};

export const resolveCatchUpRemuxAsset = async ({
  sessionCache,
  sessionId,
  kind,
  segmentIndex,
  logger,
  fetchImpl = fetch,
}: {
  sessionCache: CatchUpRemuxSessionCache;
  sessionId: string;
  kind: "init" | "segment";
  segmentIndex: number | null;
  logger: ProxyLogger;
  fetchImpl?: typeof fetch;
}): Promise<Buffer> => {
  const session = sessionCache.get(sessionId);
  if (!session) {
    throw new Error("Remux session not found or expired.");
  }

  const targetIndex = kind === "init"
    ? 0
    : (
      typeof segmentIndex === "number" && Number.isInteger(segmentIndex) && segmentIndex >= 0
        ? segmentIndex
        : -1
    );
  if (targetIndex < 0) {
    throw new Error("Invalid remux segment index.");
  }

  await queueSegmentProcessing(session, targetIndex, logger, fetchImpl);

  if (kind === "init") {
    if (!session.initSegment) {
      throw new Error("Remux init segment is unavailable.");
    }
    return session.initSegment;
  }

  const mediaSegment = session.mediaSegments.get(targetIndex);
  if (!mediaSegment) {
    throw new Error("Remux media segment is unavailable.");
  }

  return mediaSegment;
};
