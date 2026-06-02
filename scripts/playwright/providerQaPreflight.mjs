import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveXtreamAuthPreflightDecision } from './focusedPlaybackSmokeConfig.mjs';

export const DEFAULT_STORAGE_STATE_PATH = 'output/playwright/qa-user-sim/storage-state.json';
export const STORAGE_CREDENTIALS_KEY = 'lumen-web:v1:xtream_credentials';

const trimTrailingSlash = (value) => value.trim().replace(/\/+$/, '');

const normalizeProviderCredentials = (credentials) => {
  const normalized = {
    server: trimTrailingSlash(String(credentials?.server ?? '')),
    username: String(credentials?.username ?? ''),
    password: String(credentials?.password ?? ''),
  };

  const missing = Object.entries(normalized)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`Missing provider credential field(s): ${missing.join(', ')}`);
  }

  return normalized;
};

export const redactProviderValue = (value, secrets = []) => {
  if (typeof value === 'string') {
    let redacted = value;
    for (const secret of secrets) {
      if (typeof secret === 'string' && secret.length > 0) {
        redacted = redacted.split(secret).join('<redacted>');
      }
    }
    redacted = redacted.replace(/:\/\/[^:/\s]+:[^@\s]+@/g, '://<redacted>:<redacted>@');
    redacted = redacted.replace(/(username=)[^&\s]+/gi, '$1<redacted>');
    redacted = redacted.replace(/(password=)[^&\s]+/gi, '$1<redacted>');
    redacted = redacted.replace(/(\/live\/)[^/\s]+\/[^/\s]+\//gi, '$1<redacted>/<redacted>/');
    redacted = redacted.replace(/(\/timeshift_hls\/)[^/\s]+\/[^/\s]+\//gi, '$1<redacted>/<redacted>/');
    redacted = redacted.replace(/(\/timeshift\/)[^/\s]+\/[^/\s]+\//gi, '$1<redacted>/<redacted>/');
    redacted = redacted.replace(/(\/series\/)[^/\s]+\/[^/\s]+\//gi, '$1<redacted>/<redacted>/');
    redacted = redacted.replace(/(\/movie\/)[^/\s]+\/[^/\s]+\//gi, '$1<redacted>/<redacted>/');
    redacted = redacted.replace(/token=[A-Za-z0-9+/%=_-]+/g, 'token=<redacted>');
    return redacted;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactProviderValue(entry, secrets));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, redactProviderValue(entryValue, secrets)])
    );
  }

  return value;
};

export const loadStoredProviderCredentials = (
  storageStatePath = DEFAULT_STORAGE_STATE_PATH,
  cwd = process.cwd(),
) => {
  const absoluteStorageStatePath = resolve(cwd, storageStatePath);
  if (!existsSync(absoluteStorageStatePath)) {
    throw new Error(`Missing Playwright storage state: ${absoluteStorageStatePath}`);
  }

  const state = JSON.parse(readFileSync(absoluteStorageStatePath, 'utf-8'));
  const item = (state.origins ?? [])
    .flatMap((origin) => origin.localStorage ?? [])
    .find((entry) => entry.name === STORAGE_CREDENTIALS_KEY);
  if (!item?.value) {
    throw new Error(`Missing Xtream credentials in storage state: ${absoluteStorageStatePath}`);
  }

  return JSON.parse(item.value);
};

export const resolveProviderCredentials = (
  env = process.env,
  options = {},
) => {
  const envCredentials = {
    server: env.VITE_XTREAM_SERVER ?? env.E2E_XTREAM_SERVER ?? '',
    username: env.E2E_XUI_USERNAME ?? '',
    password: env.E2E_XUI_PASSWORD ?? '',
  };

  if (envCredentials.server && envCredentials.username && envCredentials.password) {
    return {
      source: 'env',
      credentials: normalizeProviderCredentials(envCredentials),
    };
  }

  const storageStatePath = options.storageStatePath ?? env.E2E_STORAGE_STATE ?? DEFAULT_STORAGE_STATE_PATH;
  const credentials = loadStoredProviderCredentials(storageStatePath, options.cwd ?? process.cwd());
  return {
    source: 'storage-state',
    credentials: normalizeProviderCredentials(credentials),
    storageStatePath,
  };
};

export const buildPlayerApiUrl = (credentials, action = null) => {
  const url = new URL(`${credentials.server}/player_api.php`);
  url.searchParams.set('username', credentials.username);
  url.searchParams.set('password', credentials.password);
  if (action) {
    url.searchParams.set('action', action);
  }
  return url;
};

const safeJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

export const runProviderQaPreflight = async ({
  credentials,
  fetchImpl = fetch,
  timeoutMs = 30_000,
}) => {
  const secrets = [credentials.username, credentials.password].filter(Boolean);
  const startedAt = Date.now();
  const authUrl = buildPlayerApiUrl(credentials);
  const liveCatalogUrl = buildPlayerApiUrl(credentials, 'get_live_streams');
  const result = {
    ok: false,
    startedAt: new Date(startedAt).toISOString(),
    elapsedMs: null,
    auth: {
      ok: false,
      status: null,
      reason: null,
    },
    liveCatalog: {
      ok: false,
      status: null,
      itemCount: 0,
      reason: null,
    },
    requests: {
      authUrl: redactProviderValue(authUrl.toString(), secrets),
      liveCatalogUrl: redactProviderValue(liveCatalogUrl.toString(), secrets),
    },
  };

  try {
    const authResponse = await fetchImpl(authUrl, { signal: AbortSignal.timeout(timeoutMs) });
    result.auth.status = authResponse.status;
    if (!authResponse.ok) {
      result.auth.reason = `http_${authResponse.status}`;
      return {
        ...result,
        elapsedMs: Date.now() - startedAt,
      };
    }

    const authPayload = await safeJson(authResponse);
    if (!authPayload) {
      result.auth.reason = 'invalid_json';
      return {
        ...result,
        elapsedMs: Date.now() - startedAt,
      };
    }

    const authDecision = resolveXtreamAuthPreflightDecision(authPayload);
    result.auth.ok = authDecision.ok;
    result.auth.reason = authDecision.reason;
    if (!authDecision.ok) {
      return {
        ...result,
        elapsedMs: Date.now() - startedAt,
      };
    }

    const liveCatalogResponse = await fetchImpl(liveCatalogUrl, { signal: AbortSignal.timeout(timeoutMs) });
    result.liveCatalog.status = liveCatalogResponse.status;
    if (!liveCatalogResponse.ok) {
      result.liveCatalog.reason = `http_${liveCatalogResponse.status}`;
      return {
        ...result,
        elapsedMs: Date.now() - startedAt,
      };
    }

    const liveCatalogPayload = await safeJson(liveCatalogResponse);
    if (!Array.isArray(liveCatalogPayload)) {
      result.liveCatalog.reason = 'unexpected_payload';
      return {
        ...result,
        elapsedMs: Date.now() - startedAt,
      };
    }

    result.liveCatalog.ok = liveCatalogPayload.length > 0;
    result.liveCatalog.itemCount = liveCatalogPayload.length;
    result.liveCatalog.reason = result.liveCatalog.ok ? null : 'empty_catalog';
    result.ok = result.auth.ok && result.liveCatalog.ok;
    return {
      ...result,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ...result,
      elapsedMs: Date.now() - startedAt,
      error: redactProviderValue(error?.message ?? String(error), secrets),
    };
  }
};
