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
  goNoGo: 'artifacts/release/readiness/qaf035-go-no-go-20260603.json',
  smokeMatrix: 'artifacts/release/smoke/qaf035-smoke-regression-matrix-20260603.json',
  compatibility: 'artifacts/release/compatibility/qaf035-provider-local-20260602.json',
  compatibilityTargets: 'scripts/release/v1-compatibility-targets.template.json',
  manualDeviceQa: 'artifacts/release/manual-device-qa/qaf035-manual-device-qa-20260603.json',
  designParity: 'artifacts/release/design/qaf035-design-parity-20260603.json',
  providerOwner: 'artifacts/release/provider/qaf035-provider-owner-signoff-20260603.json',
  betaCapacity: 'artifacts/release/capacity/qaf035-beta-capacity-20260602.json',
  performanceEvidence: 'artifacts/release/performance/qaf035-performance-evidence-20260603.json',
  runtimeMedia: 'artifacts/release/media-policy/qaf035-runtime-media-policy-20260602.json',
  noMediaScanArtifact: 'artifacts/release/media-policy/qaf035-no-media-evidence-scan-20260602.json',
  observabilityBaseline: 'artifacts/release/observability/qaf035-observability-baseline-20260603.json',
  betaOps: 'artifacts/release/ops/qaf035-beta-ops-signoff-20260603.json',
  securityBaseline: 'artifacts/release/security/qaf035-security-privacy-baseline-20260603.json',
  betaClosurePlan: 'artifacts/release/readiness/qaf035-beta-closure-plan-20260603.json',
  runbook: 'docs/release/qaf035-beta-signoff-runbook.md',
  prQualityGateWorkflow: '.github/workflows/pr-quality-gate.yml',
  packageJson: 'package.json',
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
    files.goNoGo,
    files.smokeMatrix,
    files.compatibility,
    files.compatibilityTargets,
    files.manualDeviceQa,
    files.designParity,
    files.providerOwner,
    files.betaCapacity,
    files.performanceEvidence,
    files.runtimeMedia,
    files.observabilityBaseline,
    files.betaOps,
    files.securityBaseline,
    files.betaClosurePlan,
    'pnpm release:qaf035:validate',
    'pnpm release:qaf035:final',
    'pnpm release:no-media-evidence:scan',
    'pnpm release:no-media-scan-artifact:validate',
    'pnpm release:perf-evidence:validate',
    'pnpm release:observability-baseline:validate',
    'pnpm release:security-baseline:validate',
    'pnpm release:beta-closure-plan:validate',
    'pnpm catchup:timeshift-hls:test',
    'pnpm release:proxy-no-media:validate',
    'pnpm release:proxy-no-media:test',
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
    'pnpm release:readiness:validate',
    'pnpm release:provider-owner:validate',
    'pnpm release:beta-capacity:validate',
    'pnpm release:runtime-media:validate',
    'pnpm release:manual-device-qa:validate',
    'pnpm release:beta-ops:validate',
    'concrete QAF-035 artifacts',
    'final proof command',
    'final-mode validation for the concrete go/no-go, smoke/regression, compatibility-matrix, and design-parity artifacts',
    '--require-targets',
    'narrower platform/device/browser/tag profile',
    'case results whose tags no longer match the required target profile',
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
    'pnpm release:no-media-scan-artifact:validate',
    'pnpm release:perf-evidence:validate',
    'pnpm release:observability-baseline:validate',
    'pnpm release:security-baseline:validate',
    'pnpm release:beta-closure-plan:validate',
    'pnpm catchup:timeshift-hls:test',
    'pnpm release:proxy-no-media:validate',
    'pnpm release:proxy-no-media:test',
  ];

  for (const snippet of requiredSnippets) {
    if (!content.includes(snippet)) {
      fail(`Workflow ${files.prQualityGateWorkflow} must reference: ${snippet}`);
    }
  }
};

const validatePackageScripts = () => {
  const packageJson = readJson(files.packageJson);
  const proxyNoMediaValidator = packageJson.scripts?.['release:proxy-no-media:validate'];
  if (typeof proxyNoMediaValidator !== 'string') {
    fail('package.json must define scripts.release:proxy-no-media:validate.');
  }
  if (!proxyNoMediaValidator.includes('scripts/release/validate-proxy-no-media-runtime.mjs')) {
    fail('package.json release:proxy-no-media:validate must reference scripts/release/validate-proxy-no-media-runtime.mjs');
  }

  const proxyNoMediaScript = packageJson.scripts?.['release:proxy-no-media:test'];
  if (typeof proxyNoMediaScript !== 'string') {
    fail('package.json must define scripts.release:proxy-no-media:test.');
  }

  const requiredSnippets = [
    'apps/proxy/src/catchup-remux.test.ts',
    'apps/proxy/src/catchup-gateway.test.ts',
    'apps/proxy/src/server.test.ts',
  ];

  for (const snippet of requiredSnippets) {
    if (!proxyNoMediaScript.includes(snippet)) {
      fail(`package.json release:proxy-no-media:test must reference: ${snippet}`);
    }
  }

  const disabledTimeshiftProbeTest = packageJson.scripts?.['catchup:timeshift-hls:test'];
  if (disabledTimeshiftProbeTest !== 'vitest run scripts/catchup/probe-timeshift-hls.test.ts') {
    fail('package.json scripts.catchup:timeshift-hls:test must run scripts/catchup/probe-timeshift-hls.test.ts.');
  }

  const noMediaScanArtifactValidator = packageJson.scripts?.['release:no-media-scan-artifact:validate'];
  if (noMediaScanArtifactValidator !== `node scripts/release/validate-no-media-evidence-scan-artifact.mjs ${files.noMediaScanArtifact}`) {
    fail(`package.json scripts.release:no-media-scan-artifact:validate must validate ${files.noMediaScanArtifact}.`);
  }

  const goNoGoValidator = packageJson.scripts?.['release:go-no-go:validate'];
  if (goNoGoValidator !== `node scripts/release/validate-go-no-go.mjs ${files.goNoGo}`) {
    fail(`package.json scripts.release:go-no-go:validate must validate ${files.goNoGo}.`);
  }

  const goNoGoTest = packageJson.scripts?.['release:go-no-go:test'];
  if (goNoGoTest !== 'vitest run scripts/release/v1-go-no-go.test.ts') {
    fail('package.json scripts.release:go-no-go:test must run scripts/release/v1-go-no-go.test.ts.');
  }

  const smokeMatrixValidator = packageJson.scripts?.['release:smoke-matrix:validate'];
  if (smokeMatrixValidator !== `node scripts/release/validate-smoke-regression-matrix.mjs ${files.smokeMatrix}`) {
    fail(`package.json scripts.release:smoke-matrix:validate must validate ${files.smokeMatrix}.`);
  }

  const designParityValidator = packageJson.scripts?.['release:design-parity:validate'];
  if (designParityValidator !== `node scripts/release/validate-design-parity-evidence.mjs ${files.designParity}`) {
    fail(`package.json scripts.release:design-parity:validate must validate ${files.designParity}.`);
  }

  const performanceEvidenceValidator = packageJson.scripts?.['release:perf-evidence:validate'];
  if (performanceEvidenceValidator !== `node scripts/release/validate-performance-evidence.mjs ${files.performanceEvidence}`) {
    fail(`package.json scripts.release:perf-evidence:validate must validate ${files.performanceEvidence}.`);
  }

  const betaCapacityValidator = packageJson.scripts?.['release:beta-capacity:validate'];
  if (betaCapacityValidator !== `node scripts/release/validate-beta-capacity-evidence.mjs ${files.betaCapacity}`) {
    fail(`package.json scripts.release:beta-capacity:validate must validate ${files.betaCapacity}.`);
  }

  const runtimeMediaValidator = packageJson.scripts?.['release:runtime-media:validate'];
  if (runtimeMediaValidator !== `node scripts/release/validate-runtime-media-policy.mjs ${files.runtimeMedia}`) {
    fail(`package.json scripts.release:runtime-media:validate must validate ${files.runtimeMedia}.`);
  }

  const manualDeviceQaValidator = packageJson.scripts?.['release:manual-device-qa:validate'];
  if (manualDeviceQaValidator !== `node scripts/release/validate-manual-device-qa.mjs ${files.manualDeviceQa}`) {
    fail(`package.json scripts.release:manual-device-qa:validate must validate ${files.manualDeviceQa}.`);
  }

  const betaOpsValidator = packageJson.scripts?.['release:beta-ops:validate'];
  if (betaOpsValidator !== `node scripts/release/validate-beta-ops-signoff.mjs ${files.betaOps}`) {
    fail(`package.json scripts.release:beta-ops:validate must validate ${files.betaOps}.`);
  }

  const providerOwnerValidator = packageJson.scripts?.['release:provider-owner:validate'];
  if (providerOwnerValidator !== `node scripts/release/validate-provider-owner-signoff.mjs ${files.providerOwner}`) {
    fail(`package.json scripts.release:provider-owner:validate must validate ${files.providerOwner}.`);
  }

  const observabilityBaselineValidator = packageJson.scripts?.['release:observability-baseline:validate'];
  if (observabilityBaselineValidator !== `node scripts/release/validate-observability-baseline.mjs ${files.observabilityBaseline}`) {
    fail(`package.json scripts.release:observability-baseline:validate must validate ${files.observabilityBaseline}.`);
  }

  const observabilityBaselineTest = packageJson.scripts?.['release:observability-baseline:test'];
  if (observabilityBaselineTest !== 'vitest run scripts/release/v1-observability-baseline.test.ts') {
    fail('package.json scripts.release:observability-baseline:test must run scripts/release/v1-observability-baseline.test.ts.');
  }

  const securityBaselineValidator = packageJson.scripts?.['release:security-baseline:validate'];
  if (securityBaselineValidator !== `node scripts/release/validate-security-privacy-baseline.mjs ${files.securityBaseline}`) {
    fail(`package.json scripts.release:security-baseline:validate must validate ${files.securityBaseline}.`);
  }

  const betaClosurePlanValidator = packageJson.scripts?.['release:beta-closure-plan:validate'];
  if (betaClosurePlanValidator !== `node scripts/release/validate-beta-closure-plan.mjs ${files.betaClosurePlan}`) {
    fail(`package.json scripts.release:beta-closure-plan:validate must validate ${files.betaClosurePlan}.`);
  }

  const readinessValidator = packageJson.scripts?.['release:readiness:validate'];
  if (readinessValidator !== `node scripts/release/validate-release-readiness.mjs ${files.readiness}`) {
    fail(`package.json scripts.release:readiness:validate must validate ${files.readiness}.`);
  }
};

const checks = [];
const expectedFinalValidationFailures = [];
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
    expectedFinalValidationFailures.push(`${label}: ${firstLine}`);
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
validatePackageScripts();
checks.push('package-scripts');

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

runNode('proxy no-media runtime guard', [
  'scripts/release/validate-proxy-no-media-runtime.mjs',
]);

runNode('no-media scan artifact', [
  'scripts/release/validate-no-media-evidence-scan-artifact.mjs',
  files.noMediaScanArtifact,
]);

runNode('performance evidence', [
  'scripts/release/validate-performance-evidence.mjs',
  files.performanceEvidence,
]);

runNode('observability baseline', [
  'scripts/release/validate-observability-baseline.mjs',
  files.observabilityBaseline,
]);

runNode('security/privacy baseline', [
  'scripts/release/validate-security-privacy-baseline.mjs',
  files.securityBaseline,
]);

runNode('beta blocker closure plan', [
  'scripts/release/validate-beta-closure-plan.mjs',
  files.betaClosurePlan,
]);

const finalValidators = [
  ['final go/no-go checklist', ['scripts/release/validate-go-no-go.mjs', files.goNoGo, '--require-final']],
  ['final smoke/regression matrix', ['scripts/release/validate-smoke-regression-matrix.mjs', files.smokeMatrix, '--require-final']],
  ['final compatibility matrix', ['scripts/release/compatibility-matrix-task.mjs', 'status', '--run', files.compatibility, '--require-final', '--require-targets', files.compatibilityTargets]],
  ['final design parity evidence', ['scripts/release/validate-design-parity-evidence.mjs', files.designParity, '--require-final']],
  ['final release readiness', ['scripts/release/validate-release-readiness.mjs', files.readiness, '--require-final']],
  ['final provider owner signoff', ['scripts/release/validate-provider-owner-signoff.mjs', files.providerOwner, '--require-final']],
  ['final beta capacity evidence', ['scripts/release/validate-beta-capacity-evidence.mjs', files.betaCapacity, '--require-final']],
  ['final performance evidence', ['scripts/release/validate-performance-evidence.mjs', files.performanceEvidence, '--require-final']],
  ['final runtime media policy', ['scripts/release/validate-runtime-media-policy.mjs', files.runtimeMedia, '--require-final']],
  ['final observability baseline', ['scripts/release/validate-observability-baseline.mjs', files.observabilityBaseline, '--require-final']],
  ['final manual device QA', ['scripts/release/validate-manual-device-qa.mjs', files.manualDeviceQa, '--require-final']],
  ['final beta ops signoff', ['scripts/release/validate-beta-ops-signoff.mjs', files.betaOps, '--require-final']],
  ['final security/privacy baseline', ['scripts/release/validate-security-privacy-baseline.mjs', files.securityBaseline, '--require-final']],
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
if (expectedFinalValidationFailures.length > 0) {
  console.log('[qaf035-release-gates] expected final validation failures:');
  for (const validationFailure of expectedFinalValidationFailures) {
    console.log(`- ${validationFailure}`);
  }
}
console.log('[qaf035-release-gates] OK');
