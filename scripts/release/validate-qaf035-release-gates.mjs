#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const args = process.argv.slice(2);
const requireFinal = args.includes('--require-final');
const unknownFlags = args.filter((arg) => arg !== '--require-final');

const fail = (message) => {
  console.error(`[qaf035-release-gates] ERROR: ${message}`);
  process.exit(2);
};

if (unknownFlags.length > 0) {
  fail(`Unknown flag(s): ${unknownFlags.join(', ')}`);
}

const files = {
  readiness: 'artifacts/release/readiness/qaf035-release-readiness-20260602.json',
  compatibility: 'artifacts/release/compatibility/qaf035-provider-local-20260602.json',
  manualDeviceQa: 'artifacts/release/manual-device-qa/qaf035-manual-device-qa-20260603.json',
  providerOwner: 'artifacts/release/provider/qaf035-provider-owner-signoff-20260603.json',
  betaCapacity: 'artifacts/release/capacity/qaf035-beta-capacity-20260602.json',
  runtimeMedia: 'artifacts/release/media-policy/qaf035-runtime-media-policy-20260602.json',
  betaOps: 'artifacts/release/ops/qaf035-beta-ops-signoff-20260603.json',
  runbook: 'docs/release/qaf035-beta-signoff-runbook.md',
  prQualityGateWorkflow: '.github/workflows/pr-quality-gate.yml',
};

const readJson = (filePath) => {
  const absolutePath = path.resolve(repoRoot, filePath);
  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch {
    fail(`Unable to read/parse JSON file: ${filePath}`);
  }
};

const validateRunbook = () => {
  const runbookPath = path.resolve(repoRoot, files.runbook);
  if (!fs.existsSync(runbookPath)) {
    fail(`Runbook is missing: ${files.runbook}`);
  }

  const content = fs.readFileSync(runbookPath, 'utf8');
  const manualDeviceQa = readJson(files.manualDeviceQa);
  const targetIds = manualDeviceQa.targets?.map((target) => target.id) ?? [];
  const requiredSnippets = [
    files.readiness,
    files.compatibility,
    files.manualDeviceQa,
    files.providerOwner,
    files.betaCapacity,
    files.runtimeMedia,
    files.betaOps,
    'pnpm release:qaf035:validate',
    'pnpm release:qaf035:final',
    'pnpm release:no-media-evidence:scan',
    '300-500',
    'ffmpeg',
    'ffprobe',
    'transcode',
    'remux',
    'proxy-remuxed',
    'remux-hls',
    'generated HLS',
    'XUI-side',
    ...targetIds,
  ];

  for (const snippet of requiredSnippets) {
    if (!content.includes(snippet)) {
      fail(`Runbook ${files.runbook} must reference: ${snippet}`);
    }
  }
};

const validatePrQualityGateWorkflow = () => {
  const workflowPath = path.resolve(repoRoot, files.prQualityGateWorkflow);
  if (!fs.existsSync(workflowPath)) {
    fail(`PR quality gate workflow is missing: ${files.prQualityGateWorkflow}`);
  }

  const content = fs.readFileSync(workflowPath, 'utf8');
  const requiredSnippets = [
    'release-gates',
    'pnpm release:qaf035:validate',
    'pnpm release:qaf035:test',
    'pnpm release:guardrails:test',
    'pnpm release:no-media-evidence:test',
  ];

  for (const snippet of requiredSnippets) {
    if (!content.includes(snippet)) {
      fail(`Workflow ${files.prQualityGateWorkflow} must reference: ${snippet}`);
    }
  }
};

const checks = [];
const expectedFinalBlockers = [];
const failures = [];

const runNode = (label, commandArgs, options = {}) => {
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const stdout = result.stdout?.trim() ?? '';
  const stderr = result.stderr?.trim() ?? '';

  if (options.expectFailure) {
    if (result.status === 0) {
      failures.push(`${label} was expected to fail but passed.`);
      return;
    }

    const firstLine = (stderr || stdout).split(/\r?\n/).find(Boolean) ?? 'failed as expected';
    expectedFinalBlockers.push(`${label}: ${firstLine}`);
    return;
  }

  if (result.status !== 0) {
    failures.push(`${label} failed${stderr ? `: ${stderr}` : stdout ? `: ${stdout}` : ''}`);
    return;
  }

  checks.push(label);
};

validateRunbook();
checks.push('qaf035-beta-signoff-runbook');
validatePrQualityGateWorkflow();
checks.push('pr-quality-gate-workflow');

runNode('release readiness artifact', [
  'scripts/release/validate-release-readiness.mjs',
  files.readiness,
]);

runNode('release evidence links', [
  'scripts/release/validate-release-evidence-links.mjs',
  files.readiness,
  ...(requireFinal ? [] : ['--expect-open-blockers']),
]);

runNode('release secret hygiene', [
  'scripts/release/validate-release-secret-hygiene.mjs',
]);

runNode('compatibility matrix status', [
  'scripts/release/compatibility-matrix-task.mjs',
  'status',
  '--run',
  files.compatibility,
]);

const finalValidators = [
  ['final release readiness', ['scripts/release/validate-release-readiness.mjs', files.readiness, '--require-final']],
  ['final provider owner signoff', ['scripts/release/validate-provider-owner-signoff.mjs', files.providerOwner, '--require-final']],
  ['final beta capacity evidence', ['scripts/release/validate-beta-capacity-evidence.mjs', files.betaCapacity, '--require-final']],
  ['final runtime media policy', ['scripts/release/validate-runtime-media-policy.mjs', files.runtimeMedia, '--require-final']],
  ['final manual device QA', ['scripts/release/validate-manual-device-qa.mjs', files.manualDeviceQa, '--require-final']],
  ['final beta ops signoff', ['scripts/release/validate-beta-ops-signoff.mjs', files.betaOps, '--require-final']],
];

for (const [label, commandArgs] of finalValidators) {
  runNode(label, commandArgs, { expectFailure: !requireFinal });
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`[qaf035-release-gates] ${failure}`);
  }
  fail(`${failures.length} release gate validation failure(s).`);
}

console.log(`[qaf035-release-gates] mode: ${requireFinal ? 'require-final' : 'current-open-blockers'}`);
console.log(`[qaf035-release-gates] checks passed: ${checks.length}`);
for (const check of checks) {
  console.log(`- ${check}`);
}
if (expectedFinalBlockers.length > 0) {
  console.log('[qaf035-release-gates] expected final blockers:');
  for (const blocker of expectedFinalBlockers) {
    console.log(`- ${blocker}`);
  }
}
console.log('[qaf035-release-gates] OK');
