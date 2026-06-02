import { createHash } from "node:crypto";
import type {
  CatchUpGatewayServerPolicy,
  CatchUpGatewayTransportMode,
} from "./catchup-gateway-contracts.js";

export interface GatewayLogger {
  info: (event: string, payload: Record<string, unknown>) => void;
  warn: (event: string, payload: Record<string, unknown>) => void;
  error: (event: string, payload: Record<string, unknown>) => void;
}

export interface ServerRegistryRecord {
  id: string;
  serverUrl: string;
  policy: CatchUpGatewayServerPolicy;
  createdAtMs: number;
  updatedAtMs: number;
}

const DEFAULT_ALLOWED_MODES: CatchUpGatewayTransportMode[] = [
  "provider-direct",
  "proxy-normalized",
];

const DEFAULT_POLICY: CatchUpGatewayServerPolicy = {
  catchupGatewayEnabled: true,
  enabledPlatforms: ["web"],
  allowedModes: DEFAULT_ALLOWED_MODES,
  prepPolicy: "hybrid",
  perServerConcurrency: 2,
  cacheTtlMs: 10 * 60 * 1000,
  prewarmWindowSeconds: 15 * 60,
};

const parseStringList = (value: string | undefined): string[] | null => {
  if (!value) {
    return null;
  }

  const parsed = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return parsed.length > 0 ? parsed : null;
};

const parseAllowedModes = (
  value: string | undefined,
): CatchUpGatewayTransportMode[] | null => {
  const parsed = parseStringList(value);
  if (!parsed) {
    return null;
  }

  const modes = parsed.filter(
    (entry): entry is CatchUpGatewayTransportMode => (
      entry === "provider-direct" ||
      entry === "proxy-normalized" ||
      entry === "proxy-remuxed"
    ),
  );

  return modes.length > 0 ? modes : null;
};

const normalizeServerUrl = (value: string): string => {
  try {
    const parsed = new URL(value.includes("://") ? value : `http://${value}`);
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
};

export const createDefaultServerPolicy = (
  env: NodeJS.ProcessEnv = process.env,
): CatchUpGatewayServerPolicy => ({
  catchupGatewayEnabled: env.LUMEN_CATCHUP_GATEWAY_ENABLED !== "0",
  enabledPlatforms: parseStringList(env.LUMEN_CATCHUP_GATEWAY_PLATFORMS) ?? DEFAULT_POLICY.enabledPlatforms,
  allowedModes: parseAllowedModes(env.LUMEN_CATCHUP_GATEWAY_ALLOWED_MODES) ?? DEFAULT_POLICY.allowedModes,
  prepPolicy: env.LUMEN_CATCHUP_GATEWAY_PREP_POLICY === "lazy" || env.LUMEN_CATCHUP_GATEWAY_PREP_POLICY === "eager-startup"
    ? env.LUMEN_CATCHUP_GATEWAY_PREP_POLICY
    : DEFAULT_POLICY.prepPolicy,
  perServerConcurrency: Math.max(
    1,
    Number(env.LUMEN_CATCHUP_GATEWAY_PER_SERVER_CONCURRENCY ?? DEFAULT_POLICY.perServerConcurrency),
  ),
  cacheTtlMs: Math.max(
    1_000,
    Number(env.LUMEN_CATCHUP_GATEWAY_CACHE_TTL_MS ?? DEFAULT_POLICY.cacheTtlMs),
  ),
  prewarmWindowSeconds: Math.max(
    0,
    Number(env.LUMEN_CATCHUP_GATEWAY_PREWARM_WINDOW_SECONDS ?? DEFAULT_POLICY.prewarmWindowSeconds),
  ),
});

export class ServerRegistry {
  private readonly recordsById = new Map<string, ServerRegistryRecord>();

  constructor(
    private readonly defaultPolicy: CatchUpGatewayServerPolicy,
    private readonly logger: GatewayLogger,
  ) {}

  resolve(serverUrl: string, nowMs = Date.now()): {
    record: ServerRegistryRecord;
    isNew: boolean;
  } {
    const normalizedServerUrl = normalizeServerUrl(serverUrl);
    const serverId = `server-${createHash("sha1").update(normalizedServerUrl).digest("hex").slice(0, 12)}`;
    const existing = this.recordsById.get(serverId);
    if (existing) {
      const nextRecord: ServerRegistryRecord = {
        ...existing,
        serverUrl: normalizedServerUrl,
        updatedAtMs: nowMs,
      };
      this.recordsById.set(serverId, nextRecord);
      return {
        record: nextRecord,
        isNew: false,
      };
    }

    this.logger.info("gateway.server_index_started", {
      serverId,
      serverUrl: normalizedServerUrl,
    });

    const nextRecord: ServerRegistryRecord = {
      id: serverId,
      serverUrl: normalizedServerUrl,
      policy: this.defaultPolicy,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    };
    this.recordsById.set(serverId, nextRecord);

    this.logger.info("gateway.server_index_completed", {
      serverId,
      serverUrl: normalizedServerUrl,
    });

    return {
      record: nextRecord,
      isNew: true,
    };
  }
}
