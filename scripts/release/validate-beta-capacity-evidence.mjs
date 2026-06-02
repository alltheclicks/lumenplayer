#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const allowedStatus = new Set(['pending', 'pass', 'fail']);
const requiredCheckIds = new Set([
  'provider-capacity-owner',
  'lumen-edge-capacity',
  'no-media-processing-verification',
  'observability-slo',
  'rollback-throttle-plan',
]);
const disallowedTransportModes = new Set(['proxy-remuxed', 'remux-hls']);

const usage = () => {
  console.error('Usage: node scripts/release/validate-beta-capacity-evidence.mjs <file> [--require-final]');
};

const [, , fileArg, ...flags] = process.argv;
if (!fileArg) {
  usage();
  process.exit(1);
}

const requireFinal = flags.includes('--require-final');
const filePath = path.resolve(process.cwd(), fileArg);

const fail = (message) => {
  console.error(`[beta-capacity] ERROR: ${message}`);
  process.exit(2);
};

let artifact;
try {
  artifact = JSON.parse(fs.readFileSync(filePath, 'utf8'));
} catch {
  fail(`Unable to read/parse JSON file: ${filePath}`);
}

if (!artifact.target || typeof artifact.target !== 'object') {
  fail('target object is required.');
}

if (!Number.isInteger(artifact.target.minConcurrentLiveUsers) || artifact.target.minConcurrentLiveUsers < 300) {
  fail('target.minConcurrentLiveUsers must be an integer >= 300.');
}

if (!Number.isInteger(artifact.target.maxConcurrentLiveUsers) || artifact.target.maxConcurrentLiveUsers < 500) {
  fail('target.maxConcurrentLiveUsers must be an integer >= 500.');
}

if (artifact.target.maxConcurrentLiveUsers < artifact.target.minConcurrentLiveUsers) {
  fail('target.maxConcurrentLiveUsers must be >= target.minConcurrentLiveUsers.');
}

if (typeof artifact.target.trafficModel !== 'string' || artifact.target.trafficModel.trim() === '') {
  fail('target.trafficModel must be a non-empty string.');
}

if (!artifact.mediaPath || typeof artifact.mediaPath !== 'object') {
  fail('mediaPath object is required.');
}

if (!Array.isArray(artifact.mediaPath.allowedTransportModes) || artifact.mediaPath.allowedTransportModes.length === 0) {
  fail('mediaPath.allowedTransportModes must be a non-empty array.');
}

for (const mode of artifact.mediaPath.allowedTransportModes) {
  if (typeof mode !== 'string' || mode.trim() === '') {
    fail('mediaPath.allowedTransportModes must contain non-empty strings.');
  }
  if (disallowedTransportModes.has(mode)) {
    fail(`mediaPath.allowedTransportModes must not include ${mode}.`);
  }
}

if (!Array.isArray(artifact.mediaPath.disallowedTransportModes)) {
  fail('mediaPath.disallowedTransportModes must be an array.');
}

for (const requiredDisallowed of disallowedTransportModes) {
  if (!artifact.mediaPath.disallowedTransportModes.includes(requiredDisallowed)) {
    fail(`mediaPath.disallowedTransportModes must include ${requiredDisallowed}.`);
  }
}

for (const field of [
  'usesLocalFfmpeg',
  'usesServerSideTranscode',
  'usesServerSideRemux',
  'usesGeneratedHls',
  'usesXuiSideTranscode',
  'usesXuiSideRemux',
]) {
  if (artifact.mediaPath[field] !== false) {
    fail(`mediaPath.${field} must be false.`);
  }
}

if (typeof artifact.mediaPath.evidence !== 'string') {
  fail('mediaPath.evidence must be a string.');
}

if (!Array.isArray(artifact.checks) || artifact.checks.length === 0) {
  fail('checks must be a non-empty array.');
}

const seenCheckIds = new Set();
let failedCheckCount = 0;
for (const check of artifact.checks) {
  if (!check || typeof check !== 'object') {
    fail('each check must be an object.');
  }

  if (typeof check.id !== 'string' || check.id.trim() === '') {
    fail('each check requires a non-empty id.');
  }

  if (seenCheckIds.has(check.id)) {
    fail(`duplicate check id: ${check.id}`);
  }
  seenCheckIds.add(check.id);

  if (typeof check.description !== 'string' || check.description.trim() === '') {
    fail(`check ${check.id} requires a non-empty description.`);
  }

  if (!allowedStatus.has(check.status)) {
    fail(`check ${check.id} has invalid status: ${check.status}`);
  }

  if (check.status === 'fail') {
    failedCheckCount += 1;
  }

  if (typeof check.owner !== 'string') {
    fail(`check ${check.id} owner must be a string.`);
  }

  if (typeof check.evidence !== 'string') {
    fail(`check ${check.id} evidence must be a string.`);
  }
}

for (const requiredCheckId of requiredCheckIds) {
  if (!seenCheckIds.has(requiredCheckId)) {
    fail(`required check is missing: ${requiredCheckId}`);
  }
}

if (!artifact.signoff || typeof artifact.signoff !== 'object') {
  fail('signoff object is required.');
}

if (!allowedStatus.has(artifact.signoff.status)) {
  fail('signoff.status must be pending/pass/fail.');
}

if (typeof artifact.signoff.approvedBy !== 'string') {
  fail('signoff.approvedBy must be a string.');
}

if (typeof artifact.signoff.approvedAt !== 'string') {
  fail('signoff.approvedAt must be a string.');
}

if (requireFinal) {
  if (artifact.mediaPath.evidence.trim() === '') {
    fail('mediaPath.evidence must be set with --require-final.');
  }

  for (const check of artifact.checks) {
    if (check.status === 'pending') {
      fail(`check ${check.id} is pending with --require-final.`);
    }

    if (check.owner.trim() === '') {
      fail(`check ${check.id} owner must be set with --require-final.`);
    }

    if (check.evidence.trim() === '') {
      fail(`check ${check.id} evidence must be set with --require-final.`);
    }
  }

  if (artifact.signoff.status === 'pending') {
    fail('signoff.status cannot be pending with --require-final.');
  }

  if (artifact.signoff.approvedBy.trim() === '') {
    fail('signoff.approvedBy must be set with --require-final.');
  }

  if (artifact.signoff.approvedAt.trim() === '') {
    fail('signoff.approvedAt must be set with --require-final.');
  }

  if (artifact.signoff.status === 'pass' && failedCheckCount > 0) {
    fail('signoff.status cannot be pass while any capacity check is fail.');
  }
}

console.log(`[beta-capacity] OK: ${filePath}`);
console.log(`[beta-capacity] checks: ${artifact.checks.length}`);
console.log(`[beta-capacity] require-final: ${requireFinal ? 'yes' : 'no'}`);
