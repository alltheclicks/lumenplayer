import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

export const DEFAULT_CAPACITY_REQUESTS = 80;
export const DEFAULT_CAPACITY_CONCURRENCY = 20;
export const DEFAULT_CAPACITY_TIMEOUT_MS = 10_000;

export const normalizeOrigin = (value) => (
  (value || '').trim().replace(/\/+$/, '')
);

export const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const percentile = (values, ratio) => {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1),
  );
  return Number(sorted[index].toFixed(3));
};

export const buildCapacityEndpoints = ({ appUrl, proxyUrl }) => {
  const endpoints = [
    {
      id: 'web-player',
      url: `${appUrl}/player`,
      expect: { status: 200, contentTypeIncludes: 'text/html' },
    },
    {
      id: 'web-manifest',
      url: `${appUrl}/manifest.webmanifest`,
      expect: { status: 200, contentTypeIncludes: 'application/manifest+json' },
    },
    {
      id: 'cast-receiver',
      url: `${appUrl}/receiver.html`,
      expect: { status: 200, textIncludes: 'Lumen Cast Receiver' },
    },
  ];

  if (proxyUrl) {
    endpoints.push({
      id: 'proxy-health',
      url: `${proxyUrl}/health`,
      expect: { status: 200, textIncludes: '"ok":true' },
    });
  }

  return endpoints;
};

const fetchWithTimeout = async (url, timeoutMs) => {
  const startedAt = performance.now();
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const elapsedMs = performance.now() - startedAt;
  return { response, elapsedMs };
};

const verifyEndpoint = async (endpoint, timeoutMs) => {
  const { response, elapsedMs } = await fetchWithTimeout(endpoint.url, timeoutMs);
  const contentType = response.headers.get('content-type') ?? '';
  const text = endpoint.expect.textIncludes ? await response.text() : '';

  const ok = (
    response.status === endpoint.expect.status &&
    (!endpoint.expect.contentTypeIncludes || contentType.includes(endpoint.expect.contentTypeIncludes)) &&
    (!endpoint.expect.textIncludes || text.includes(endpoint.expect.textIncludes))
  );

  return {
    ok,
    status: response.status,
    contentType,
    elapsedMs: Number(elapsedMs.toFixed(3)),
  };
};

const runOneRequest = async (endpoint, timeoutMs) => {
  const startedAt = performance.now();
  try {
    const response = await fetch(endpoint.url, { signal: AbortSignal.timeout(timeoutMs) });
    await response.arrayBuffer();
    const elapsedMs = performance.now() - startedAt;
    return {
      ok: response.status === endpoint.expect.status,
      status: response.status,
      elapsedMs: Number(elapsedMs.toFixed(3)),
    };
  } catch (error) {
    const elapsedMs = performance.now() - startedAt;
    return {
      ok: false,
      status: 0,
      elapsedMs: Number(elapsedMs.toFixed(3)),
      error: error?.message ?? String(error),
    };
  }
};

export const runEndpointLoad = async ({ endpoint, requests, concurrency, timeoutMs }) => {
  const results = [];
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < requests) {
      nextIndex += 1;
      results.push(await runOneRequest(endpoint, timeoutMs));
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, requests) }, () => worker()),
  );

  const ok = results.filter((result) => result.ok).length;
  const failed = results.length - ok;
  const latencies = results.map((result) => result.elapsedMs);
  const errors = results
    .filter((result) => !result.ok)
    .slice(0, 5)
    .map((result) => result.error || `HTTP ${result.status}`);

  return {
    id: endpoint.id,
    url: endpoint.url,
    requests,
    concurrency,
    ok,
    failed,
    p95Ms: percentile(latencies, 0.95),
    p99Ms: percentile(latencies, 0.99),
    maxMs: Number(Math.max(...latencies).toFixed(3)),
    errors,
  };
};

export const renderCapacitySmokeMarkdown = (report) => {
  const lines = [
    '# Staging capacity smoke',
    '',
    `- Status: ${report.status.toUpperCase()}`,
    `- App URL: ${report.appUrl}`,
    `- Proxy URL: ${report.proxyUrl || 'n/a'}`,
    `- Requests per endpoint: ${report.requests}`,
    `- Concurrency per endpoint: ${report.concurrency}`,
    `- Timeout: ${report.timeoutMs}ms`,
    `- Generated at: ${report.generatedAt}`,
    '',
    '## Endpoints',
    '',
  ];

  for (const endpoint of report.endpoints) {
    lines.push(
      `- ${endpoint.id}: ${endpoint.ok}/${endpoint.requests} ok, failed=${endpoint.failed}, p95=${endpoint.p95Ms}ms, p99=${endpoint.p99Ms}ms, max=${endpoint.maxMs}ms`,
    );
  }

  lines.push(
    '',
    '## Scope',
    '',
    'This smoke requests static app, manifest, receiver, and proxy health endpoints only. It does not request provider media streams and is not final 300-500 user deployed capacity proof.',
  );

  return `${lines.join('\n')}\n`;
};

export const runStagingCapacitySmoke = async ({
  appUrl = normalizeOrigin(process.env.E2E_CAPACITY_APP_URL || process.env.E2E_MOBILE_LAYOUT_BASE_URL || 'http://127.0.0.1:8080'),
  proxyUrl = normalizeOrigin(process.env.E2E_CAPACITY_PROXY_URL || process.env.E2E_MOBILE_LAYOUT_PROXY_ORIGIN || ''),
  requests = parsePositiveInt(process.env.E2E_CAPACITY_REQUESTS, DEFAULT_CAPACITY_REQUESTS),
  concurrency = parsePositiveInt(process.env.E2E_CAPACITY_CONCURRENCY, DEFAULT_CAPACITY_CONCURRENCY),
  timeoutMs = parsePositiveInt(process.env.E2E_CAPACITY_TIMEOUT_MS, DEFAULT_CAPACITY_TIMEOUT_MS),
  outDir = 'output/perf/staging-capacity-smoke',
} = {}) => {
  if (!appUrl) {
    throw new Error('E2E_CAPACITY_APP_URL is required.');
  }

  const endpoints = buildCapacityEndpoints({ appUrl, proxyUrl });
  const verification = [];
  for (const endpoint of endpoints) {
    verification.push({
      id: endpoint.id,
      ...(await verifyEndpoint(endpoint, timeoutMs)),
    });
  }

  const endpointReports = [];
  for (const endpoint of endpoints) {
    endpointReports.push(await runEndpointLoad({
      endpoint,
      requests,
      concurrency,
      timeoutMs,
    }));
  }

  const report = {
    status: (
      verification.every((entry) => entry.ok) &&
      endpointReports.every((entry) => entry.failed === 0)
    ) ? 'pass' : 'fail',
    generatedAt: new Date().toISOString(),
    appUrl,
    proxyUrl,
    requests,
    concurrency,
    timeoutMs,
    verification,
    endpoints: endpointReports,
    scope: 'static-app-manifest-receiver-proxy-health-only-no-provider-media-streams',
  };

  const absoluteOutDir = path.resolve(process.cwd(), outDir);
  fs.mkdirSync(absoluteOutDir, { recursive: true });
  fs.writeFileSync(path.join(absoluteOutDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(absoluteOutDir, 'REPORT.md'), renderCapacitySmokeMarkdown(report));

  return report;
};
