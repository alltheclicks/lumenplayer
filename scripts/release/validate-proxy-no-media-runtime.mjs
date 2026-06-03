#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
let repoRoot = process.cwd();

const fail = (message) => {
  console.error(`[proxy-no-media-runtime] ERROR: ${message}`);
  process.exit(2);
};

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--repo-root') {
    const value = args[index + 1];
    if (!value) {
      fail('--repo-root requires a path.');
    }
    repoRoot = path.resolve(process.cwd(), value);
    index += 1;
    continue;
  }
  fail(`Unknown argument: ${arg}`);
}

const readText = (filePath) => {
  const absolutePath = path.resolve(repoRoot, filePath);
  if (!fs.existsSync(absolutePath)) {
    fail(`missing required file: ${filePath}`);
  }
  return fs.readFileSync(absolutePath, 'utf8');
};

const assertIncludes = (label, content, snippets) => {
  for (const snippet of snippets) {
    if (!content.includes(snippet)) {
      fail(`${label} must include: ${snippet}`);
    }
  }
};

const assertExcludes = (label, content, snippets) => {
  for (const snippet of snippets) {
    if (content.includes(snippet)) {
      fail(`${label} must not include stale no-media wording: ${snippet}`);
    }
  }
};

const assertOrdered = (label, content, orderedSnippets) => {
  let cursor = -1;
  for (const snippet of orderedSnippets) {
    const index = content.indexOf(snippet, cursor + 1);
    if (index < 0) {
      fail(`${label} must include ordered snippet after index ${cursor}: ${snippet}`);
    }
    cursor = index;
  }
};

const catchupRemux = readText('apps/proxy/src/catchup-remux.ts');
const catchupRemuxTest = readText('apps/proxy/src/catchup-remux.test.ts');
const packageJson = JSON.parse(readText('package.json'));
const workflow = readText('.github/workflows/pr-quality-gate.yml');
const runtimePolicy = readText('artifacts/release/media-policy/qaf035-runtime-media-policy-20260602.json');
const runbook = readText('docs/release/qaf035-beta-signoff-runbook.md');
const backlog = readText('BACKLOG.md');
const handoff = readText('HANDOFF.md');
const qaFixBacklog = readText('docs/V3-QA-FIX-BACKLOG.md');

assertIncludes('apps/proxy/src/catchup-remux.ts', catchupRemux, [
  'const isCatchUpRemuxRuntimeDisabled = (): boolean => true;',
  'const createRemuxDisabledError = (): CatchUpRemuxError => new CatchUpRemuxError(',
  '"remux-disabled"',
  'disabled by the no-media-processing runtime policy',
]);

assertOrdered('prepareSession hard-disable guard', catchupRemux, [
  'const createRemuxDisabledError = (): CatchUpRemuxError => new CatchUpRemuxError(',
  'const isCatchUpRemuxRuntimeDisabled = (): boolean => true;',
  'const prepareSession = async (',
  'if (isCatchUpRemuxRuntimeDisabled()) {',
  'throw createRemuxDisabledError();',
  'ensureBinaryAvailability();',
]);

assertOrdered('getAsset hard-disable guard', catchupRemux, [
  'const getAsset = async (input: CatchUpRemuxAssetRequest): Promise<Buffer> => {',
  'if (isCatchUpRemuxRuntimeDisabled()) {',
  'throw createRemuxDisabledError();',
  'const session = getSession(input.sessionId);',
]);

assertOrdered('matchesFeatureGate hard-disable guard', catchupRemux, [
  'const matchesFeatureGate = ({',
  'if (isCatchUpRemuxRuntimeDisabled()) {',
  'return false;',
  'if (!featureGate.enabled || !candidateUrl) {',
]);

assertIncludes('apps/proxy/src/catchup-remux.test.ts', catchupRemuxTest, [
  'does not match the legacy feature gate even when every env filter matches',
  'rejects direct session preparation before binary checks or process spawn',
  'rejects manifest generation before binary checks or process spawn',
  'parses legacy asset URLs but never serves generated HLS assets',
  'expect(checkBinary).not.toHaveBeenCalled();',
  'expect(spawnProcess).not.toHaveBeenCalled();',
  'disabled by the no-media-processing runtime policy',
]);

const proxyNoMediaScript = packageJson.scripts?.['release:proxy-no-media:test'];
if (typeof proxyNoMediaScript !== 'string') {
  fail('package.json must define scripts.release:proxy-no-media:test.');
}
assertIncludes('package.json release:proxy-no-media:test', proxyNoMediaScript, [
  'apps/proxy/src/catchup-remux.test.ts',
  'apps/proxy/src/catchup-gateway.test.ts',
  'apps/proxy/src/server.test.ts',
]);

assertIncludes('.github/workflows/pr-quality-gate.yml', workflow, [
  'Test proxy no-media runtime guard',
  'pnpm release:proxy-no-media:test',
  'Validate proxy no-media runtime guard',
  'pnpm release:proxy-no-media:validate',
]);

assertIncludes('runtime media policy artifact', runtimePolicy, [
  'direct remux controller calls fail before binary checks or process spawn',
  'pnpm release:proxy-no-media:test',
]);

assertIncludes('QAF-035 beta signoff runbook', runbook, [
  'direct remux controller calls do not reach binary checks, process spawn, or remux playback',
  'pnpm release:proxy-no-media:test',
]);

assertIncludes('BACKLOG.md QAF-035 current no-media direction', backlog, [
  'no transcode/remux fallback',
  'active invariant: broken catch-up channels must stay on provider bytes, proxy-normalized manifests, or unsupported overlay',
  'historical March remux/transcode notes remain preserved for audit context only',
]);

assertIncludes('HANDOFF.md QAF-035 current no-media direction', handoff, [
  'Session 2026-06-03 — QAF-035 no-media production guard alignment',
  'historical March remux/transcode branches and notes below are preserved for audit context only',
  'apps/proxy/src/catchup-remux.ts` hard-disables direct controller calls before binary checks or process spawn',
  'The later remux/transcode fallback direction is superseded by the current no-media production policy at the top of this handoff.',
]);
assertExcludes('HANDOFF.md QAF-035 current no-media direction', handoff, [
  'appears to require real transport normalization/remux work',
]);

assertIncludes('docs/V3-QA-FIX-BACKLOG.md QAF-035 current no-media direction', qaFixBacklog, [
  'without transcode/remux fallback',
  'Current no-media production note (2026-06-03)',
  'This supersedes older March/April remux fallback notes for beta/release direction.',
  'Historical remux/transcode evidence remains below for audit context only',
  'Historical next ready queue (superseded by current no-media note)',
  'proxy-normalized manifest handling or unsupported overlay is required',
]);
assertExcludes('docs/V3-QA-FIX-BACKLOG.md QAF-035 current no-media direction', qaFixBacklog, [
  'gateway normalization/remux is required',
]);

console.log('[proxy-no-media-runtime] OK: remux controller hard-disable and release guard coverage verified');
