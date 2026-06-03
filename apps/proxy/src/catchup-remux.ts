import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { access, mkdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { CatchUpGatewayResolveRequest } from "./catchup-gateway-contracts.js";
import { parseProxyTargetUrl } from "./proxy-url.js";
import type { GatewayLogger } from "./server-registry.js";

const REMUX_TRANSPORT_HINT_PARAM = "__lumenTransport";
const REMUX_TRANSPORT_HINT = "remux-hls";
const REMUX_INIT_PATH_PATTERN = /^\/xui-api\/__remux__\/session\/([^/]+)\/init\.mp4$/i;
const REMUX_SEGMENT_PATH_PATTERN = /^\/xui-api\/__remux__\/session\/([^/]+)\/segment\/(\d+)\.m4s$/i;
const REMUX_BASE_PATH = "/xui-api/__remux__/session";
const REMUX_SESSION_ROOT = path.join(os.tmpdir(), "lumen-catchup-remux");
const DEFAULT_REMUX_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const DEFAULT_REMUX_GLOBAL_CONCURRENCY = 4;
const DEFAULT_REMUX_WAIT_TIMEOUT_MS = 20_000;
const DEFAULT_REMUX_QUEUE_WAIT_TIMEOUT_MS = 0;
const DEFAULT_REMUX_POLL_INTERVAL_MS = 150;
const DEFAULT_REMUX_EXTRA_PREWARM_SEGMENTS = 2;
const PLAYLIST_FILENAME = "index.m3u8";
const INIT_FILENAME = "init.mp4";
const SEGMENT_DIRECTORY_NAME = "segment";
const EXACT_RAW_TIMESHIFT_TS_PATTERN = /^\/timeshift\/[^/]+\/[^/]+\/[^/]+\/[^/]+\/[^/]+\.ts$/i;
const GENERIC_TS_PATH_PATTERN = /\.ts$/i;
const GENERIC_M4S_PATH_PATTERN = /(\d+)\.m4s(?:\?.*)?$/i;
const DEFAULT_FFMPEG_BIN = "ffmpeg";
const DEFAULT_FFPROBE_BIN = "ffprobe";

type CatchUpRemuxProfile = "copy" | "transcode";
type CatchUpRemuxStrategy = "transcode" | "copy" | "copy-then-transcode";

type RemuxSessionStatus =
  | "starting"
  | "preparing"
  | "ready"
  | "failed"
  | "finished";

interface CatchUpRemuxFeatureGate {
  enabled: boolean;
  hosts: Set<string> | null;
  streamIds: Set<number> | null;
  programIds: Set<string> | null;
  ffmpegBin: string;
  ffprobeBin: string;
  sessionTtlMs: number;
  globalConcurrency: number;
  queueWaitTimeoutMs: number;
  extraPrewarmSegments: number;
  waitTimeoutMs: number;
  strategy: CatchUpRemuxStrategy;
}

export interface CatchUpRemuxSessionRecord {
  sessionId: string;
  requestKey: string;
  upstreamUrl: string;
  tempDir: string;
  status: RemuxSessionStatus;
  processHandle: {
    kill: (signal?: NodeJS.Signals | number) => void;
    pid?: number;
  } | null;
  playlistPath: string;
  initPath: string;
  segmentDir: string;
  createdAtMs: number;
  lastAccessAtMs: number;
  errorMessage: string | null;
}

export interface CatchUpRemuxManifestResponse {
  body: string;
  contentType: string;
  sessionId: string;
}

export interface CatchUpRemuxAssetRequest {
  sessionId: string;
  kind: "init" | "segment";
  segmentIndex: number | null;
}

interface CatchUpRemuxPrepareInput {
  upstreamUrl: URL;
  serverKey?: string;
  perServerConcurrency?: number;
}

interface SpawnCatchUpRemuxProcessOptions {
  ffmpegBin: string;
  upstreamUrl: string;
  playlistPath: string;
  segmentDir: string;
  profile: CatchUpRemuxProfile;
}

interface SpawnCatchUpRemuxProcessResult {
  handle: {
    kill: (signal?: NodeJS.Signals | number) => void;
    pid?: number;
  };
  completion: Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    stderrMessage: string | null;
  }>;
}

type SpawnCatchUpRemuxProcess = (
  options: SpawnCatchUpRemuxProcessOptions,
) => SpawnCatchUpRemuxProcessResult;

type BinaryChecker = (binary: string) => boolean;

interface PendingPreparationTask<TValue> {
  serverKey: string;
  perServerConcurrency: number;
  run: () => void;
  reject: (reason?: unknown) => void;
  timeoutHandle: NodeJS.Timeout | null;
}

interface InternalSessionRecord extends CatchUpRemuxSessionRecord {
  completionPromise: Promise<void> | null;
  releaseCapacity: (() => void) | null;
  releaseCapacityOnFailure: boolean;
}

export interface CatchUpRemuxController {
  matchesFeatureGate: (args: {
    request: CatchUpGatewayResolveRequest;
    candidateUrl: string | null;
  }) => boolean;
  isRemuxPlaybackRequest: (upstreamUrl: URL) => boolean;
  prepareSession: (
    input: CatchUpRemuxPrepareInput,
  ) => Promise<CatchUpRemuxSessionRecord>;
  getManifest: (
    input: CatchUpRemuxPrepareInput,
  ) => Promise<CatchUpRemuxManifestResponse>;
  getAsset: (input: CatchUpRemuxAssetRequest) => Promise<Buffer>;
  parseAssetRequest: (requestUrl: URL) => CatchUpRemuxAssetRequest | null;
  sweep: () => void;
  close: () => Promise<void>;
}

class CatchUpRemuxError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CatchUpRemuxError";
  }
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

const matchesOptionalFilter = <TValue>(
  filter: Set<TValue> | null,
  value: TValue | null,
): boolean => filter === null || (value !== null && filter.has(value));

const parseNonNegativeInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
};

const parseRemuxStrategy = (value: string | undefined): CatchUpRemuxStrategy => {
  switch (value?.trim().toLowerCase()) {
    case "copy":
      return "copy";
    case "copy-then-transcode":
      return "copy-then-transcode";
    case "transcode":
    default:
      return "transcode";
  }
};

const createCatchUpRemuxFeatureGate = (
  env: NodeJS.ProcessEnv = process.env,
): CatchUpRemuxFeatureGate => ({
  enabled: env.LUMEN_PROXY_REMUX_ENABLED === "1",
  hosts: parseStringFilter(env.LUMEN_PROXY_REMUX_HOSTS),
  streamIds: parseNumericFilter(env.LUMEN_PROXY_REMUX_STREAM_IDS),
  programIds: parseStringFilter(env.LUMEN_PROXY_REMUX_PROGRAM_IDS),
  ffmpegBin: env.LUMEN_PROXY_REMUX_FFMPEG_BIN?.trim() || DEFAULT_FFMPEG_BIN,
  ffprobeBin: env.LUMEN_PROXY_REMUX_FFPROBE_BIN?.trim() || DEFAULT_FFPROBE_BIN,
  sessionTtlMs: Math.max(
    1_000,
    parseNonNegativeInteger(env.LUMEN_PROXY_REMUX_SESSION_TTL_MS, DEFAULT_REMUX_SESSION_TTL_MS),
  ),
  globalConcurrency: Math.max(
    1,
    parseNonNegativeInteger(env.LUMEN_PROXY_REMUX_GLOBAL_CONCURRENCY, DEFAULT_REMUX_GLOBAL_CONCURRENCY),
  ),
  queueWaitTimeoutMs: Math.max(
    0,
    parseNonNegativeInteger(env.LUMEN_PROXY_REMUX_QUEUE_WAIT_TIMEOUT_MS, DEFAULT_REMUX_QUEUE_WAIT_TIMEOUT_MS),
  ),
  extraPrewarmSegments: Math.max(
    0,
    parseNonNegativeInteger(env.LUMEN_PROXY_REMUX_EXTRA_PREWARM_SEGMENTS, DEFAULT_REMUX_EXTRA_PREWARM_SEGMENTS),
  ),
  waitTimeoutMs: Math.max(
    1_000,
    parseNonNegativeInteger(env.LUMEN_PROXY_REMUX_WAIT_TIMEOUT_MS, DEFAULT_REMUX_WAIT_TIMEOUT_MS),
  ),
  strategy: parseRemuxStrategy(env.LUMEN_PROXY_REMUX_STRATEGY),
});

const parseCandidateUpstreamUrl = (value: string): URL | null => {
  const proxied = parseProxyTargetUrl(value);
  if (proxied?.upstreamUrl) {
    return proxied.upstreamUrl;
  }

  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const isExactRawTimeshiftTsCandidate = (value: string): boolean => {
  const upstreamUrl = parseCandidateUpstreamUrl(value);
  if (!upstreamUrl) {
    return false;
  }

  return EXACT_RAW_TIMESHIFT_TS_PATTERN.test(upstreamUrl.pathname);
};

const isGenericTsCandidate = (value: string): boolean => {
  const upstreamUrl = parseCandidateUpstreamUrl(value);
  if (!upstreamUrl) {
    return false;
  }

  return (
    EXACT_RAW_TIMESHIFT_TS_PATTERN.test(upstreamUrl.pathname) ||
    GENERIC_TS_PATH_PATTERN.test(upstreamUrl.pathname) ||
    upstreamUrl.searchParams.get("extension")?.toLowerCase() === "ts"
  );
};

export const selectCatchUpRemuxCandidate = (
  sourceCandidates: CatchUpGatewayResolveRequest["sourceCandidates"],
): string | null => {
  const preferredRedirectTs = sourceCandidates.redirectUrls.find(isExactRawTimeshiftTsCandidate);
  if (preferredRedirectTs) {
    return preferredRedirectTs;
  }

  return (
    sourceCandidates.redirectUrls.find(isGenericTsCandidate) ??
    sourceCandidates.queryUrls.find(isGenericTsCandidate) ??
    sourceCandidates.legacyUrls.find(isGenericTsCandidate) ??
    null
  );
};

export const parseCatchUpRemuxAssetRequest = (
  requestUrl: URL,
): CatchUpRemuxAssetRequest | null => {
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

const buildInitAssetPath = (sessionId: string): string => `${REMUX_BASE_PATH}/${sessionId}/init.mp4`;

const buildSegmentAssetPath = (sessionId: string, segmentIndex: number): string => (
  `${REMUX_BASE_PATH}/${sessionId}/segment/${segmentIndex}.m4s`
);

const buildSegmentFilename = (segmentIndex: number): string => `${String(segmentIndex).padStart(5, "0")}.m4s`;

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

const isRemuxPlaybackRequest = (upstreamUrl: URL): boolean => (
  upstreamUrl.searchParams.get(REMUX_TRANSPORT_HINT_PARAM) === REMUX_TRANSPORT_HINT
);

const defaultBinaryChecker: BinaryChecker = (binary) => {
  const result = spawnSync(binary, ["-version"], {
    stdio: "ignore",
  });

  return !result.error && result.status === 0;
};

const buildCopyProfileArgs = ({
  upstreamUrl,
  playlistPath,
  segmentDir,
}: {
  upstreamUrl: string;
  playlistPath: string;
  segmentDir: string;
}): string[] => ([
  "-hide_banner",
  "-loglevel",
  "warning",
  "-y",
  "-fflags",
  "+genpts+igndts+discardcorrupt",
  "-i",
  upstreamUrl,
  "-map",
  "0:v:0",
  "-map",
  "0:a:0?",
  "-c:v",
  "copy",
  "-c:a",
  "copy",
  "-copyinkf",
  "-f",
  "hls",
  "-hls_time",
  "6",
  "-hls_list_size",
  "0",
  "-hls_playlist_type",
  "event",
  "-hls_segment_type",
  "fmp4",
  "-hls_flags",
  "independent_segments+temp_file",
  "-hls_fmp4_init_filename",
  INIT_FILENAME,
  "-hls_segment_filename",
  path.join(segmentDir, "%05d.m4s"),
  playlistPath,
]);

const buildTranscodeProfileArgs = ({
  upstreamUrl,
  playlistPath,
  segmentDir,
}: {
  upstreamUrl: string;
  playlistPath: string;
  segmentDir: string;
}): string[] => ([
  "-hide_banner",
  "-loglevel",
  "warning",
  "-y",
  "-fflags",
  "+genpts+igndts+discardcorrupt",
  "-i",
  upstreamUrl,
  "-map",
  "0:v:0",
  "-map",
  "0:a:0?",
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  "-profile:v",
  "main",
  "-level",
  "4.0",
  "-g",
  "48",
  "-keyint_min",
  "48",
  "-sc_threshold",
  "0",
  "-force_key_frames",
  "expr:gte(t,n_forced*6)",
  "-c:a",
  "aac",
  "-b:a",
  "128k",
  "-ac",
  "2",
  "-f",
  "hls",
  "-hls_time",
  "6",
  "-hls_list_size",
  "0",
  "-hls_playlist_type",
  "event",
  "-hls_segment_type",
  "fmp4",
  "-hls_flags",
  "independent_segments+temp_file",
  "-hls_fmp4_init_filename",
  INIT_FILENAME,
  "-hls_segment_filename",
  path.join(segmentDir, "%05d.m4s"),
  playlistPath,
]);

const buildFfmpegArgsForProfile = (
  profile: CatchUpRemuxProfile,
  options: {
    upstreamUrl: string;
    playlistPath: string;
    segmentDir: string;
  },
): string[] => (
  profile === "copy"
    ? buildCopyProfileArgs(options)
    : buildTranscodeProfileArgs(options)
);

const defaultSpawnProcess: SpawnCatchUpRemuxProcess = ({
  ffmpegBin,
  upstreamUrl,
  playlistPath,
  segmentDir,
  profile,
}) => {
  const args = buildFfmpegArgsForProfile(profile, {
    upstreamUrl,
    playlistPath,
    segmentDir,
  });

  const child = spawn(ffmpegBin, args, {
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderrMessage = "";

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    const nextMessage = `${stderrMessage}${chunk}`;
    stderrMessage = nextMessage.slice(-4_096);
  });

  return {
    handle: child,
    completion: new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => {
        resolve({
          code,
          signal,
          stderrMessage: stderrMessage.trim().length > 0 ? stderrMessage.trim() : null,
        });
      });
    }),
  };
};

const rewriteManifestForSession = (
  sessionId: string,
  manifestBody: string,
): string => manifestBody
  .replace(/\r\n/g, "\n")
  .split("\n")
  .map((line) => {
    if (line.startsWith("#EXT-X-MAP:")) {
      return line.replace(/URI="[^"]*"/, `URI="${buildInitAssetPath(sessionId)}"`);
    }

    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      return line;
    }

    const match = trimmed.match(GENERIC_M4S_PATH_PATTERN);
    if (!match?.[1]) {
      return line;
    }

    return buildSegmentAssetPath(sessionId, Number(match[1]));
  })
  .join("\n");

const toRemuxFallbackReason = (error: unknown): string => (
  error instanceof CatchUpRemuxError
    ? error.code
    : "remux-unavailable"
);

const toRemuxError = (code: string, error: unknown, fallbackMessage: string): CatchUpRemuxError => {
  if (error instanceof CatchUpRemuxError) {
    return error;
  }

  const message = error instanceof Error && error.message.trim().length > 0
    ? error.message
    : fallbackMessage;
  return new CatchUpRemuxError(code, message);
};

const createRemuxDisabledError = (): CatchUpRemuxError => new CatchUpRemuxError(
  "remux-disabled",
  "Catch-up remux/transcode playback is disabled by the no-media-processing runtime policy.",
);

const isCatchUpRemuxRuntimeDisabled = (): boolean => true;

export const createCatchUpRemuxController = (options: {
  logger: GatewayLogger;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  spawnProcess?: SpawnCatchUpRemuxProcess;
  checkBinary?: BinaryChecker;
  tempRootDir?: string;
  globalConcurrency?: number;
}): CatchUpRemuxController => {
  const featureGate = createCatchUpRemuxFeatureGate(options.env);
  const now = options.now ?? Date.now;
  const spawnProcess = options.spawnProcess ?? defaultSpawnProcess;
  const checkBinary = options.checkBinary ?? defaultBinaryChecker;
  const tempRootDir = options.tempRootDir ?? REMUX_SESSION_ROOT;
  const globalConcurrency = Math.max(1, options.globalConcurrency ?? featureGate.globalConcurrency);
  const sessionsById = new Map<string, InternalSessionRecord>();
  const sessionIdByRequestKey = new Map<string, string>();
  const inFlightPreparations = new Map<string, Promise<CatchUpRemuxSessionRecord>>();
  const activeByServer = new Map<string, number>();
  const pendingTasks: Array<PendingPreparationTask<CatchUpRemuxSessionRecord>> = [];
  let activeGlobalCount = 0;
  let binaryAvailability: { ok: boolean; message: string | null } | null = null;

  const touchSession = (session: InternalSessionRecord): void => {
    session.lastAccessAtMs = now();
  };

  const getSession = (sessionId: string): InternalSessionRecord | null => {
    const session = sessionsById.get(sessionId);
    if (!session) {
      return null;
    }

    if (now() - session.lastAccessAtMs > featureGate.sessionTtlMs) {
      deleteSession(session);
      return null;
    }

    touchSession(session);
    return session;
  };

  const getSessionByRequestKey = (requestKey: string): InternalSessionRecord | null => {
    const sessionId = sessionIdByRequestKey.get(requestKey);
    if (!sessionId) {
      return null;
    }

    return getSession(sessionId);
  };

  const resolveBinaryAvailability = (): { ok: boolean; message: string | null } => {
    if (binaryAvailability) {
      return binaryAvailability;
    }

    if (!checkBinary(featureGate.ffmpegBin)) {
      binaryAvailability = {
        ok: false,
        message: `Catch-up remux binary is unavailable: ${featureGate.ffmpegBin}`,
      };
      return binaryAvailability;
    }

    binaryAvailability = {
      ok: true,
      message: null,
    };
    return binaryAvailability;
  };

  const ensureBinaryAvailability = (): void => {
    const availability = resolveBinaryAvailability();
    if (!availability.ok) {
      throw new CatchUpRemuxError(
        "remux-binaries-missing",
        availability.message ?? "Catch-up remux binaries are unavailable.",
      );
    }
  };

  const deleteSession = (session: InternalSessionRecord): void => {
    sessionsById.delete(session.sessionId);
    sessionIdByRequestKey.delete(session.requestKey);
    try {
      session.processHandle?.kill("SIGKILL");
    } catch {
      // ignore cleanup failures
    }
    rmSync(session.tempDir, {
      recursive: true,
      force: true,
    });
    session.processHandle = null;
    session.completionPromise = null;
    session.releaseCapacity?.();
    session.releaseCapacity = null;
  };

  const resolveServerKey = (input: CatchUpRemuxPrepareInput): string => (
    input.serverKey?.trim() ||
    input.upstreamUrl.host.trim().toLowerCase() ||
    "catchup-remux"
  );

  const resolvePerServerConcurrency = (input: CatchUpRemuxPrepareInput): number => Math.max(
    1,
    Math.floor(input.perServerConcurrency ?? 2),
  );

  const resolveStrategyProfiles = (): CatchUpRemuxProfile[] => {
    switch (featureGate.strategy) {
      case "copy":
        return ["copy"];
      case "copy-then-transcode":
        return ["copy", "transcode"];
      case "transcode":
      default:
        return ["transcode"];
    }
  };

  const canRun = (serverKey: string, perServerConcurrency: number): boolean => (
    activeGlobalCount < globalConcurrency &&
    (activeByServer.get(serverKey) ?? 0) < perServerConcurrency
  );

  const flushPending = (): void => {
    for (let index = 0; index < pendingTasks.length; index += 1) {
      const pendingTask = pendingTasks[index];
      if (!pendingTask || !canRun(pendingTask.serverKey, pendingTask.perServerConcurrency)) {
        continue;
      }

      pendingTasks.splice(index, 1);
      if (pendingTask.timeoutHandle) {
        clearTimeout(pendingTask.timeoutHandle);
        pendingTask.timeoutHandle = null;
      }
      pendingTask.run();
      index -= 1;
    }
  };

  const acquireCapacity = (input: CatchUpRemuxPrepareInput): Promise<() => void> => new Promise((resolve, reject) => {
      const serverKey = resolveServerKey(input);
      const perServerConcurrency = resolvePerServerConcurrency(input);

      const release = () => {
        activeGlobalCount = Math.max(0, activeGlobalCount - 1);
        const nextServerCount = Math.max(0, (activeByServer.get(serverKey) ?? 1) - 1);
        if (nextServerCount === 0) {
          activeByServer.delete(serverKey);
        } else {
          activeByServer.set(serverKey, nextServerCount);
        }
        flushPending();
      };

      const start = () => {
        activeGlobalCount += 1;
        activeByServer.set(serverKey, (activeByServer.get(serverKey) ?? 0) + 1);
        resolve(release);
      };

      if (canRun(serverKey, perServerConcurrency)) {
        start();
        return;
      }

      const pendingTask: PendingPreparationTask<CatchUpRemuxSessionRecord> = {
        serverKey,
        perServerConcurrency,
        run: start,
        reject,
        timeoutHandle: null,
      };

      if (featureGate.queueWaitTimeoutMs > 0) {
        pendingTask.timeoutHandle = setTimeout(() => {
          const pendingIndex = pendingTasks.indexOf(pendingTask);
          if (pendingIndex >= 0) {
            pendingTasks.splice(pendingIndex, 1);
          }
          pendingTask.reject(new CatchUpRemuxError(
            "remux-capacity-exhausted",
            `Catch-up remux queue timed out after ${featureGate.queueWaitTimeoutMs}ms.`,
          ));
        }, featureGate.queueWaitTimeoutMs);
        pendingTask.timeoutHandle.unref?.();
      }

      pendingTasks.push(pendingTask);
    });

  const waitForFile = async (
    session: InternalSessionRecord,
    filePath: string,
    timeoutMs = featureGate.waitTimeoutMs ?? DEFAULT_REMUX_WAIT_TIMEOUT_MS,
  ): Promise<void> => {
    const startedAtMs = Date.now();

    while (true) {
      try {
        await access(filePath);
        const fileStat = await stat(filePath);
        if (fileStat.isFile() && fileStat.size > 0) {
          return;
        }
      } catch {
        // keep polling
      }

      if (session.status === "failed") {
        throw new CatchUpRemuxError(
          "remux-bootstrap-failed",
          session.errorMessage ?? "Catch-up remux session failed.",
        );
      }

      if (Date.now() - startedAtMs >= timeoutMs) {
        throw new CatchUpRemuxError(
          "remux-bootstrap-failed",
          `Timed out waiting for remux asset ${path.basename(filePath)}.`,
        );
      }

      await delay(DEFAULT_REMUX_POLL_INTERVAL_MS);
    }
  };

  const handleProcessCompletion = async (
    session: InternalSessionRecord,
    completion: SpawnCatchUpRemuxProcessResult["completion"],
  ): Promise<void> => {
    let shouldReleaseCapacity = true;

    try {
      const result = await completion;
      session.processHandle = null;
      if (result.code === 0) {
        session.status = "finished";
        session.errorMessage = null;
        options.logger.info("catchup.remux_process_finished", {
          sessionId: session.sessionId,
          requestKey: session.requestKey,
          upstreamUrl: session.upstreamUrl,
        });
        return;
      }

      shouldReleaseCapacity = session.releaseCapacityOnFailure;
      session.status = "failed";
      session.errorMessage = result.stderrMessage ??
        `ffmpeg exited with code ${result.code ?? "unknown"}${result.signal ? ` (${result.signal})` : ""}.`;
      options.logger.warn("catchup.remux_process_failed", {
        sessionId: session.sessionId,
        requestKey: session.requestKey,
        upstreamUrl: session.upstreamUrl,
        message: session.errorMessage,
      });
    } catch (error) {
      const normalizedError = toRemuxError(
        "remux-bootstrap-failed",
        error,
        "Catch-up remux process failed to start.",
      );
      shouldReleaseCapacity = session.releaseCapacityOnFailure;
      session.processHandle = null;
      session.status = "failed";
      session.errorMessage = normalizedError.message;
      options.logger.warn("catchup.remux_process_failed", {
        sessionId: session.sessionId,
        requestKey: session.requestKey,
        upstreamUrl: session.upstreamUrl,
        message: session.errorMessage,
      });
    } finally {
      if (shouldReleaseCapacity) {
        session.releaseCapacity?.();
        session.releaseCapacity = null;
      }
    }
  };

  const startSession = async (session: InternalSessionRecord): Promise<void> => {
    const cleanupOutputs = async (): Promise<void> => {
      await rm(session.tempDir, {
        recursive: true,
        force: true,
      });
      await mkdir(session.segmentDir, {
        recursive: true,
      });
    };

    const stopActiveProcess = async (): Promise<void> => {
      try {
        session.processHandle?.kill("SIGKILL");
      } catch {
        // ignore kill failures during retry
      }

      if (session.completionPromise) {
        try {
          await session.completionPromise;
        } catch {
          // ignore completion failures during retry
        }
      }

      session.processHandle = null;
      session.completionPromise = null;
    };

    let lastError: CatchUpRemuxError | null = null;
    const profiles = resolveStrategyProfiles();
    for (const [profileIndex, profile] of profiles.entries()) {
      await cleanupOutputs();
      session.status = "preparing";
      session.errorMessage = null;
      session.releaseCapacityOnFailure = profileIndex === profiles.length - 1;

      const spawned = spawnProcess({
        ffmpegBin: featureGate.ffmpegBin,
        upstreamUrl: session.upstreamUrl,
        playlistPath: session.playlistPath,
        segmentDir: session.segmentDir,
        profile,
      });

      session.processHandle = spawned.handle;
      session.completionPromise = handleProcessCompletion(session, spawned.completion);

      try {
        await waitForBootstrapAssets(session);
        options.logger.info("catchup.remux_profile_selected", {
          sessionId: session.sessionId,
          requestKey: session.requestKey,
          upstreamUrl: session.upstreamUrl,
          profile,
        });
        return;
      } catch (error) {
        lastError = toRemuxError(
          "remux-bootstrap-failed",
          error,
          "Catch-up remux bootstrap failed.",
        );
        options.logger.warn("catchup.remux_profile_failed", {
          sessionId: session.sessionId,
          requestKey: session.requestKey,
          upstreamUrl: session.upstreamUrl,
          profile,
          message: lastError.message,
        });
        await stopActiveProcess();
      }
    }

    throw lastError ?? new CatchUpRemuxError(
      "remux-bootstrap-failed",
      "Catch-up remux bootstrap failed.",
    );
  };

  const waitForBootstrapAssets = async (session: InternalSessionRecord): Promise<void> => {
    await waitForFile(session, session.playlistPath);
    await waitForFile(session, session.initPath);
    await waitForFile(session, path.join(session.segmentDir, buildSegmentFilename(0)));

    if (session.status === "failed") {
      throw new CatchUpRemuxError(
        "remux-bootstrap-failed",
        session.errorMessage ?? "Catch-up remux session failed.",
      );
    }

    if (session.status === "preparing" || session.status === "starting") {
      session.status = "ready";
    }
  };

  const prewarmAdditionalSegments = async (session: InternalSessionRecord): Promise<void> => {
    for (let segmentIndex = 1; segmentIndex <= featureGate.extraPrewarmSegments; segmentIndex += 1) {
      if (session.status === "failed") {
        return;
      }

      try {
        await waitForFile(session, path.join(session.segmentDir, buildSegmentFilename(segmentIndex)), 5_000);
      } catch {
        return;
      }
    }
  };

  const createSession = (
    sanitizedUpstreamUrl: URL,
    releaseCapacity: () => void,
  ): InternalSessionRecord => {
    const sessionId = randomUUID();
    const tempDir = path.join(tempRootDir, sessionId);
    const session: InternalSessionRecord = {
      sessionId,
      requestKey: sanitizedUpstreamUrl.toString(),
      upstreamUrl: sanitizedUpstreamUrl.toString(),
      tempDir,
      status: "starting",
      processHandle: null,
      playlistPath: path.join(tempDir, PLAYLIST_FILENAME),
      initPath: path.join(tempDir, INIT_FILENAME),
      segmentDir: path.join(tempDir, SEGMENT_DIRECTORY_NAME),
      createdAtMs: now(),
      lastAccessAtMs: now(),
      errorMessage: null,
      completionPromise: null,
      releaseCapacity,
      releaseCapacityOnFailure: true,
    };

    sessionsById.set(session.sessionId, session);
    sessionIdByRequestKey.set(session.requestKey, session.sessionId);
    return session;
  };

  const prepareSession = async (
    input: CatchUpRemuxPrepareInput,
  ): Promise<CatchUpRemuxSessionRecord> => {
    if (isCatchUpRemuxRuntimeDisabled()) {
      throw createRemuxDisabledError();
    }

    ensureBinaryAvailability();

    const sanitizedUpstreamUrl = sanitizeLocalParams(input.upstreamUrl);
    const requestKey = sanitizedUpstreamUrl.toString();
    const existingSession = getSessionByRequestKey(requestKey);
    if (existingSession && existingSession.status !== "failed") {
      await waitForBootstrapAssets(existingSession);
      return existingSession;
    }

    if (existingSession?.status === "failed") {
      deleteSession(existingSession);
    }

    const existingPreparation = inFlightPreparations.get(requestKey);
    if (existingPreparation) {
      return existingPreparation;
    }

    const preparation = (async () => {
      const releaseCapacity = await acquireCapacity(input);
      const session = createSession(sanitizedUpstreamUrl, releaseCapacity);
      try {
        await startSession(session);
        touchSession(session);
        void prewarmAdditionalSegments(session);
        options.logger.info("catchup.remux_prepared", {
          sessionId: session.sessionId,
          requestKey: session.requestKey,
          upstreamUrl: session.upstreamUrl,
          status: session.status,
        });
        return session;
      } catch (error) {
        const normalizedError = toRemuxError(
          "remux-bootstrap-failed",
          error,
          "Catch-up remux bootstrap failed.",
        );
        session.status = "failed";
        session.errorMessage = normalizedError.message;
        deleteSession(session);
        throw normalizedError;
      }
    })().finally(() => {
      inFlightPreparations.delete(requestKey);
    });

    inFlightPreparations.set(requestKey, preparation);
    return preparation;
  };

  const getManifest = async (
    input: CatchUpRemuxPrepareInput,
  ): Promise<CatchUpRemuxManifestResponse> => {
    const session = await prepareSession(input);
    touchSession(session as InternalSessionRecord);
    const manifestBody = await readFile(session.playlistPath, "utf8");

    return {
      body: rewriteManifestForSession(session.sessionId, manifestBody),
      contentType: "application/vnd.apple.mpegurl; charset=utf-8",
      sessionId: session.sessionId,
    };
  };

  const getAsset = async (input: CatchUpRemuxAssetRequest): Promise<Buffer> => {
    if (isCatchUpRemuxRuntimeDisabled()) {
      throw createRemuxDisabledError();
    }

    const session = getSession(input.sessionId);
    if (!session) {
      throw new CatchUpRemuxError("remux-asset-missing", "Remux session not found or expired.");
    }

    if (input.kind === "segment" && (input.segmentIndex === null || input.segmentIndex < 0)) {
      throw new CatchUpRemuxError("remux-asset-missing", "Invalid remux segment index.");
    }

    const filePath = input.kind === "init"
      ? session.initPath
      : path.join(session.segmentDir, buildSegmentFilename(input.segmentIndex ?? -1));

    await waitForFile(session, filePath);
    touchSession(session);
    return readFile(filePath);
  };

  const matchesFeatureGate = ({
    request,
    candidateUrl,
  }: {
    request: CatchUpGatewayResolveRequest;
    candidateUrl: string | null;
  }): boolean => {
    if (isCatchUpRemuxRuntimeDisabled()) {
      return false;
    }

    if (!featureGate.enabled || !candidateUrl) {
      return false;
    }

    const upstreamCandidateUrl = parseCandidateUpstreamUrl(candidateUrl);
    const host = upstreamCandidateUrl?.hostname.trim().toLowerCase() || null;

    return (
      matchesOptionalFilter(featureGate.streamIds, Math.floor(request.streamId)) &&
      matchesOptionalFilter(featureGate.programIds, request.programId.trim().toLowerCase()) &&
      matchesOptionalFilter(featureGate.hosts, host)
    );
  };

  const sweep = (): void => {
    const staleCutoff = now() - featureGate.sessionTtlMs;

    for (const session of sessionsById.values()) {
      if (session.lastAccessAtMs <= staleCutoff) {
        deleteSession(session);
      }
    }
  };

  const close = async (): Promise<void> => {
    for (const session of Array.from(sessionsById.values())) {
      deleteSession(session);
    }

    await rm(tempRootDir, {
      recursive: true,
      force: true,
    });
  };

  return {
    matchesFeatureGate,
    isRemuxPlaybackRequest,
    prepareSession,
    getManifest,
    getAsset,
    parseAssetRequest: parseCatchUpRemuxAssetRequest,
    sweep,
    close,
  };
};

export const getCatchUpRemuxFallbackReason = (error: unknown): string => toRemuxFallbackReason(error);
