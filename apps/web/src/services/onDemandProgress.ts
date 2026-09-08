import { getAppStorage, loadStoredCredentials } from './storage';
import { resolveConfiguredXtreamCredentials } from './xtreamCredentials';

export interface OnDemandProgress {
  key: string;
  positionMs: number;
  durationMs: number;
  updatedAt: number;
}

type ContentMetadata = { mode?: unknown; vodId?: unknown; seriesId?: unknown; episodeId?: unknown };
export const onDemandProgressKey = (metadata?: ContentMetadata): string | null => {
  if (metadata?.mode === 'vod' && metadata.vodId) return `vod:${metadata.vodId}`;
  if (metadata?.mode === 'series-episode' && metadata.seriesId && metadata.episodeId) {
    return `series:${metadata.seriesId}:${metadata.episodeId}`;
  }
  return null;
};

export const resumablePositionMs = (entry?: OnDemandProgress): number => {
  if (!entry || !Number.isFinite(entry.positionMs) || !Number.isFinite(entry.durationMs)) return 0;
  if (entry.positionMs < 5_000 || entry.durationMs <= 0) return 0;
  const endMarginMs = Math.min(30_000, entry.durationMs * 0.05);
  return entry.positionMs < entry.durationMs - endMarginMs ? Math.floor(entry.positionMs) : 0;
};

let pendingWrite: Promise<void> = Promise.resolve();

export const getOnDemandProgressScope = async (): Promise<string | null> => {
  try {
    const credentials = await loadStoredCredentials();
    if (!credentials) return null;
    // Keep accounts/providers separate without storing another copy of login details.
    const resolved = resolveConfiguredXtreamCredentials(credentials);
    const bytes = new TextEncoder().encode(JSON.stringify([resolved.server, resolved.username]));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const scope = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    return `on-demand-progress:${scope}`;
  } catch {
    return null;
  }
};

const readEntries = async (scope: string): Promise<Record<string, OnDemandProgress>> => {
  const stored = await getAppStorage()?.get<unknown>(scope);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
  return Object.fromEntries(Object.entries(stored).filter(([key, value]) => (
    value && typeof value === 'object' && value.key === key
    && Number.isFinite(value.positionMs) && Number.isFinite(value.durationMs)
    && Number.isFinite(value.updatedAt)
  )));
};

export const loadOnDemandProgress = async (): Promise<Record<string, OnDemandProgress>> => {
  try {
    await pendingWrite;
    const scope = await getOnDemandProgressScope();
    return scope ? await readEntries(scope) : {};
  } catch {
    return {};
  }
};

export const saveOnDemandProgress = (scope: string, entry: OnDemandProgress): Promise<void> => {
  pendingWrite = pendingWrite.then(async () => {
    const entries = await readEntries(scope);
    entries[entry.key] = entry;
    const bounded = Object.values(entries).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 200);
    await getAppStorage()?.set(scope, Object.fromEntries(bounded.map(item => [item.key, item])));
  }).catch(() => { /* Storage may be disabled/full; playback must remain usable. */ });
  return pendingWrite;
};
