import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  redactProviderValue,
  resolveProviderCredentials,
  runProviderQaPreflight,
} from './providerQaPreflight.mjs';

const root = process.cwd();
const outDir = resolve(root, 'output/playwright/provider-qa-preflight');
const reportJsonPath = resolve(outDir, 'report.json');
const reportMdPath = resolve(outDir, 'REPORT.md');

const parseTimeoutMs = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30_000;
};

const renderMarkdownReport = (report) => {
  const lines = [
    '# Provider QA preflight',
    '',
    `- Status: ${report.ok ? 'PASS' : 'FAIL'}`,
    `- Credential source: ${report.credentialSource ?? 'unresolved'}`,
    `- Timeout: ${report.timeoutMs}ms`,
  ];

  if (report.storageStatePath) {
    lines.push(`- Storage state: ${report.storageStatePath}`);
  }

  lines.push(
    '',
    '## Auth',
    '',
    `- OK: ${report.result?.auth?.ok ?? false}`,
    `- HTTP status: ${report.result?.auth?.status ?? 'n/a'}`,
    `- Reason: ${report.result?.auth?.reason ?? 'n/a'}`,
    '',
    '## Live catalog',
    '',
    `- OK: ${report.result?.liveCatalog?.ok ?? false}`,
    `- HTTP status: ${report.result?.liveCatalog?.status ?? 'n/a'}`,
    `- Item count: ${report.result?.liveCatalog?.itemCount ?? 0}`,
    `- Reason: ${report.result?.liveCatalog?.reason ?? 'n/a'}`,
  );

  if (report.error) {
    lines.push('', '## Error', '', report.error);
  }

  if (report.result?.requests) {
    lines.push(
      '',
      '## Requests',
      '',
      `- Auth: ${report.result.requests.authUrl}`,
      `- Live catalog: ${report.result.requests.liveCatalogUrl}`,
    );
  }

  return `${lines.join('\n')}\n`;
};

const writeReport = (report) => {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  writeFileSync(reportMdPath, renderMarkdownReport(report), 'utf-8');
};

const main = async () => {
  const timeoutMs = parseTimeoutMs(process.env.E2E_PROVIDER_PREFLIGHT_TIMEOUT_MS);
  let credentialResolution = null;

  try {
    credentialResolution = resolveProviderCredentials(process.env, { cwd: root });
    const result = await runProviderQaPreflight({
      credentials: credentialResolution.credentials,
      timeoutMs,
    });
    const report = {
      ok: result.ok,
      generatedAt: new Date().toISOString(),
      credentialSource: credentialResolution.source,
      storageStatePath: credentialResolution.storageStatePath ?? null,
      timeoutMs,
      result,
    };

    writeReport(report);
    console.log(`Provider QA preflight ${report.ok ? 'passed' : 'failed'}: ${reportMdPath}`);
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    const secrets = [
      credentialResolution?.credentials?.username,
      credentialResolution?.credentials?.password,
    ].filter(Boolean);
    const report = {
      ok: false,
      generatedAt: new Date().toISOString(),
      credentialSource: credentialResolution?.source ?? null,
      storageStatePath: credentialResolution?.storageStatePath ?? null,
      timeoutMs,
      error: redactProviderValue(error?.message ?? String(error), secrets),
      result: null,
    };

    writeReport(report);
    console.error(`Provider QA preflight failed: ${reportMdPath}`);
    process.exitCode = 1;
  }
};

await main();
