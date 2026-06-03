import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tempRoots: string[] = [];

const writeFixtureFile = (root: string, filePath: string, content: string) => {
  const absolutePath = path.join(root, filePath);
  mkdirSync(path.dirname(absolutePath), {
    recursive: true,
  });
  writeFileSync(absolutePath, content);
};

const createFixture = (overrides: Record<string, string> = {}) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'lumen-proxy-no-media-'));
  tempRoots.push(root);

  const files: Record<string, string> = {
    'apps/proxy/src/catchup-remux.ts': [
      'const createRemuxDisabledError = (): CatchUpRemuxError => new CatchUpRemuxError(',
      '  "remux-disabled",',
      '  "Catch-up remux/transcode playback is disabled by the no-media-processing runtime policy.",',
      ');',
      'const isCatchUpRemuxRuntimeDisabled = (): boolean => true;',
      'const prepareSession = async (input: CatchUpRemuxPrepareInput): Promise<CatchUpRemuxSessionRecord> => {',
      '  if (isCatchUpRemuxRuntimeDisabled()) {',
      '    throw createRemuxDisabledError();',
      '  }',
      '  ensureBinaryAvailability();',
      '};',
      'const getAsset = async (input: CatchUpRemuxAssetRequest): Promise<Buffer> => {',
      '  if (isCatchUpRemuxRuntimeDisabled()) {',
      '    throw createRemuxDisabledError();',
      '  }',
      '  const session = getSession(input.sessionId);',
      '};',
      'const matchesFeatureGate = ({ request, candidateUrl }) => {',
      '  if (isCatchUpRemuxRuntimeDisabled()) {',
      '    return false;',
      '  }',
      '  if (!featureGate.enabled || !candidateUrl) {',
      '    return false;',
      '  }',
      '};',
    ].join('\n'),
    'apps/proxy/src/catchup-remux.test.ts': [
      'does not match the legacy feature gate even when every env filter matches',
      'rejects direct session preparation before binary checks or process spawn',
      'rejects manifest generation before binary checks or process spawn',
      'parses legacy asset URLs but never serves generated HLS assets',
      'expect(checkBinary).not.toHaveBeenCalled();',
      'expect(spawnProcess).not.toHaveBeenCalled();',
      'disabled by the no-media-processing runtime policy',
    ].join('\n'),
    'package.json': JSON.stringify({
      scripts: {
        'release:proxy-no-media:validate': 'node scripts/release/validate-proxy-no-media-runtime.mjs',
        'release:proxy-no-media:test': 'vitest run apps/proxy/src/catchup-remux.test.ts apps/proxy/src/catchup-gateway.test.ts apps/proxy/src/server.test.ts',
      },
    }, null, 2),
    '.github/workflows/pr-quality-gate.yml': [
      '      - name: Validate proxy no-media runtime guard',
      '        run: pnpm release:proxy-no-media:validate',
      '      - name: Test proxy no-media runtime guard',
      '        run: pnpm release:proxy-no-media:test',
    ].join('\n'),
    'artifacts/release/media-policy/qaf035-runtime-media-policy-20260602.json': [
      'direct remux controller calls fail before binary checks or process spawn',
      'pnpm release:proxy-no-media:test',
    ].join('\n'),
    'docs/release/qaf035-beta-signoff-runbook.md': [
      'direct remux controller calls do not reach binary checks, process spawn, or remux playback',
      'pnpm release:proxy-no-media:test',
    ].join('\n'),
    'BACKLOG.md': [
      'no transcode/remux fallback',
      'active invariant: broken catch-up channels must stay on provider bytes, proxy-normalized manifests, or unsupported overlay',
      'historical March remux/transcode notes remain preserved for audit context only',
    ].join('\n'),
    'HANDOFF.md': [
      'Session 2026-06-03 — QAF-035 no-media production guard alignment',
      'historical March remux/transcode branches and notes below are preserved for audit context only',
      'apps/proxy/src/catchup-remux.ts` hard-disables direct controller calls before binary checks or process spawn',
      'The later remux/transcode fallback direction is superseded by the current no-media production policy at the top of this handoff.',
    ].join('\n'),
    'docs/V3-QA-FIX-BACKLOG.md': [
      'without transcode/remux fallback',
      'Current no-media production note (2026-06-03)',
      'This supersedes older March/April remux fallback notes for beta/release direction.',
      'Historical remux/transcode evidence remains below for audit context only',
      'Historical next ready queue (superseded by current no-media note)',
      'proxy-normalized manifest handling or unsupported overlay is required',
    ].join('\n'),
    ...overrides,
  };

  for (const [filePath, content] of Object.entries(files)) {
    writeFixtureFile(root, filePath, content);
  }

  return root;
};

const runValidator = (root: string) => (
  spawnSync(process.execPath, [
    'scripts/release/validate-proxy-no-media-runtime.mjs',
    '--repo-root',
    root,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
);

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
});

describe('proxy no-media runtime validator', () => {
  it('accepts a fixture with controller-level remux hard-disable coverage', () => {
    const result = runValidator(createFixture());

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('remux controller hard-disable');
  });

  it('fails when the remux controller hard-disable marker is missing', () => {
    const result = runValidator(createFixture({
      'apps/proxy/src/catchup-remux.ts': 'const isCatchUpRemuxRuntimeDisabled = (): boolean => false;',
    }));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('catchup-remux.ts must include');
  });

  it('fails when current-truth docs reintroduce stale remux-required wording', () => {
    const result = runValidator(createFixture({
      'docs/V3-QA-FIX-BACKLOG.md': [
        'without transcode/remux fallback',
        'Current no-media production note (2026-06-03)',
        'This supersedes older March/April remux fallback notes for beta/release direction.',
        'Historical remux/transcode evidence remains below for audit context only',
        'Historical next ready queue (superseded by current no-media note)',
        'proxy-normalized manifest handling or unsupported overlay is required',
        'gateway normalization/remux is required',
      ].join('\n'),
    }));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('must not include stale no-media wording');
  });
});
