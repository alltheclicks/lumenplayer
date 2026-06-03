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
});
