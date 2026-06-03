#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const usage = () => {
  console.error('Usage: node scripts/release/validate-release-evidence-links.mjs <readiness-file> [--expect-open-blockers]');
};

const [, , fileArg, ...flags] = process.argv;
if (!fileArg) {
  usage();
  process.exit(1);
}

const expectOpenBlockers = flags.includes('--expect-open-blockers');
const repoRoot = process.cwd();
const readinessPath = path.resolve(repoRoot, fileArg);

const fail = (message) => {
  console.error(`[release-evidence-links] ERROR: ${message}`);
  process.exit(2);
};

const run = (args, label, expectFailure = false) => {
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  if (expectFailure ? result.status === 0 : result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    fail(`${label} ${expectFailure ? 'was expected to fail but passed' : 'failed'}${stderr ? `: ${stderr}` : stdout ? `: ${stdout}` : ''}`);
  }

  return result;
};

let readiness;
try {
  readiness = JSON.parse(fs.readFileSync(readinessPath, 'utf8'));
} catch {
  fail(`Unable to read/parse readiness JSON file: ${readinessPath}`);
}

run(['scripts/release/validate-release-readiness.mjs', readinessPath], 'release readiness validation');

if (!Array.isArray(readiness.gates) || readiness.gates.length === 0) {
  fail('readiness.gates must be a non-empty array.');
}

const artifactValidators = new Map([
  ['go-no-go-checklist', ['scripts/release/validate-go-no-go.mjs']],
  ['smoke-regression-matrix', ['scripts/release/validate-smoke-regression-matrix.mjs']],
  ['manual-device-qa-evidence', ['scripts/release/validate-manual-device-qa.mjs']],
  ['design-parity-evidence', ['scripts/release/validate-design-parity-evidence.mjs']],
  ['performance-evidence', ['scripts/release/validate-performance-evidence.mjs']],
  ['provider-owner-signoff', ['scripts/release/validate-provider-owner-signoff.mjs']],
  ['beta-capacity-evidence', ['scripts/release/validate-beta-capacity-evidence.mjs']],
  ['runtime-media-policy', ['scripts/release/validate-runtime-media-policy.mjs']],
  ['observability-baseline', ['scripts/release/validate-observability-baseline.mjs']],
  ['beta-ops-signoff', ['scripts/release/validate-beta-ops-signoff.mjs']],
  ['security-privacy-baseline', ['scripts/release/validate-security-privacy-baseline.mjs']],
]);

const concreteArtifactGateIds = new Set([
  'go-no-go-checklist',
  'smoke-regression-matrix',
  'compatibility-matrix',
  'manual-device-qa-evidence',
  'design-parity-evidence',
  'performance-evidence',
  'provider-owner-signoff',
  'beta-capacity-evidence',
  'runtime-media-policy',
  'observability-baseline',
  'beta-ops-signoff',
  'security-privacy-baseline',
]);

for (const gate of readiness.gates) {
  if (!gate || typeof gate !== 'object') {
    fail('each readiness gate must be an object.');
  }
  if (typeof gate.id !== 'string' || gate.id.trim() === '') {
    fail('each readiness gate requires a non-empty id.');
  }
  if (typeof gate.evidenceRef !== 'string' || gate.evidenceRef.trim() === '') {
    fail(`gate ${gate.id} requires evidenceRef.`);
  }
  if (gate.evidenceRef.includes('<run-id>')) {
    fail(`gate ${gate.id} still points at placeholder evidenceRef: ${gate.evidenceRef}`);
  }

  const evidencePath = path.resolve(repoRoot, gate.evidenceRef);
  if (!fs.existsSync(evidencePath)) {
    fail(`gate ${gate.id} evidenceRef does not exist: ${gate.evidenceRef}`);
  }
  if (concreteArtifactGateIds.has(gate.id) && !gate.evidenceRef.startsWith('artifacts/release/')) {
    fail(`gate ${gate.id} must point at a concrete artifacts/release evidence file.`);
  }

  if (gate.id === 'compatibility-matrix') {
    run(['scripts/release/compatibility-matrix-task.mjs', 'status', '--run', evidencePath], `compatibility artifact validation for ${gate.id}`);
    continue;
  }

  const validator = artifactValidators.get(gate.id);
  if (validator) {
    run([...validator, evidencePath], `evidence validation for ${gate.id}`);
  }
}

if (expectOpenBlockers) {
  if (!readiness.blockerTriage || !Number.isInteger(readiness.blockerTriage.totalOpen)) {
    fail('blockerTriage.totalOpen is required with --expect-open-blockers.');
  }
  if (readiness.blockerTriage.totalOpen <= 0) {
    fail('blockerTriage.totalOpen must be greater than zero with --expect-open-blockers.');
  }
  if (!Array.isArray(readiness.blockerTriage.items) || !readiness.blockerTriage.items.some((item) => item.status === 'open')) {
    fail('at least one blockerTriage item must be open with --expect-open-blockers.');
  }
  if (readiness.signoff?.status !== 'pending') {
    fail('readiness.signoff.status must remain pending with --expect-open-blockers.');
  }

  run(['scripts/release/validate-release-readiness.mjs', readinessPath, '--require-final'], 'final readiness validation', true);
}

console.log(`[release-evidence-links] OK: ${readinessPath}`);
console.log(`[release-evidence-links] gates: ${readiness.gates.length}`);
console.log(`[release-evidence-links] expect-open-blockers: ${expectOpenBlockers ? 'yes' : 'no'}`);
