#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const allowedStatus = new Set(['pending', 'pass', 'fail']);
const allowedBlockerStatus = new Set(['open', 'mitigated', 'closed']);
const requiredGateIds = new Set([
  'go-no-go-checklist',
  'compatibility-matrix',
  'performance-evidence',
  'observability-baseline',
  'security-privacy-baseline',
]);

const usage = () => {
  console.error('Usage: node scripts/release/validate-release-readiness.mjs <file> [--require-final]');
};

const [, , fileArg, ...flags] = process.argv;
if (!fileArg) {
  usage();
  process.exit(1);
}

const requireFinal = flags.includes('--require-final');
const filePath = path.resolve(process.cwd(), fileArg);

const fail = (message) => {
  console.error(`[release-readiness] ERROR: ${message}`);
  process.exit(2);
};

let review;
try {
  review = JSON.parse(fs.readFileSync(filePath, 'utf8'));
} catch {
  fail(`Unable to read/parse JSON file: ${filePath}`);
}

if (!Array.isArray(review.gates) || review.gates.length === 0) {
  fail('gates must be a non-empty array.');
}

const seenGateIds = new Set();
for (const gate of review.gates) {
  if (!gate || typeof gate !== 'object') {
    fail('each gate entry must be an object.');
  }

  if (typeof gate.id !== 'string' || gate.id.trim() === '') {
    fail('each gate entry requires a non-empty id.');
  }

  if (seenGateIds.has(gate.id)) {
    fail(`duplicate gate id: ${gate.id}`);
  }
  seenGateIds.add(gate.id);

  if (typeof gate.name !== 'string' || gate.name.trim() === '') {
    fail(`gate ${gate.id} requires a non-empty name.`);
  }

  if (!allowedStatus.has(gate.status)) {
    fail(`gate ${gate.id} has invalid status: ${gate.status}`);
  }

  if (typeof gate.evidenceRef !== 'string' || gate.evidenceRef.trim() === '') {
    fail(`gate ${gate.id} requires evidenceRef.`);
  }

  if (typeof gate.checkedAt !== 'string') {
    fail(`gate ${gate.id} checkedAt must be a string.`);
  }
}

for (const requiredGateId of requiredGateIds) {
  if (!seenGateIds.has(requiredGateId)) {
    fail(`required gate is missing: ${requiredGateId}`);
  }
}

if (!review.blockerTriage || typeof review.blockerTriage !== 'object') {
  fail('blockerTriage object is required.');
}

if (!Number.isInteger(review.blockerTriage.totalOpen) || review.blockerTriage.totalOpen < 0) {
  fail('blockerTriage.totalOpen must be a non-negative integer.');
}

if (typeof review.blockerTriage.triagedAt !== 'string') {
  fail('blockerTriage.triagedAt must be a string.');
}

if (typeof review.blockerTriage.owner !== 'string') {
  fail('blockerTriage.owner must be a string.');
}

if (!Array.isArray(review.blockerTriage.items)) {
  fail('blockerTriage.items must be an array.');
}

const seenBlockerIds = new Set();
let openBlockerCount = 0;
for (const blocker of review.blockerTriage.items) {
  if (!blocker || typeof blocker !== 'object') {
    fail('each blockerTriage.items entry must be an object.');
  }

  if (typeof blocker.id !== 'string' || blocker.id.trim() === '') {
    fail('each blocker entry requires a non-empty id.');
  }

  if (seenBlockerIds.has(blocker.id)) {
    fail(`duplicate blocker id: ${blocker.id}`);
  }
  seenBlockerIds.add(blocker.id);

  if (typeof blocker.summary !== 'string' || blocker.summary.trim() === '') {
    fail(`blocker ${blocker.id} requires summary.`);
  }

  if (!allowedBlockerStatus.has(blocker.status)) {
    fail(`blocker ${blocker.id} has invalid status: ${blocker.status}`);
  }

  if (typeof blocker.disposition !== 'string' || blocker.disposition.trim() === '') {
    fail(`blocker ${blocker.id} requires disposition.`);
  }

  if (typeof blocker.owner !== 'string' || blocker.owner.trim() === '') {
    fail(`blocker ${blocker.id} requires owner.`);
  }

  if (typeof blocker.issueRef !== 'string') {
    fail(`blocker ${blocker.id} issueRef must be a string.`);
  }

  if (blocker.status === 'open') {
    openBlockerCount += 1;
  }
}

if (openBlockerCount !== review.blockerTriage.totalOpen) {
  fail(`blockerTriage.totalOpen (${review.blockerTriage.totalOpen}) does not match open blocker count (${openBlockerCount}).`);
}

if (!review.rollback || typeof review.rollback !== 'object') {
  fail('rollback object is required.');
}

if (typeof review.rollback.owner !== 'string') {
  fail('rollback.owner must be a string.');
}

if (typeof review.rollback.notificationChannel !== 'string') {
  fail('rollback.notificationChannel must be a string.');
}

if (!Number.isInteger(review.rollback.maxDecisionMinutes) || review.rollback.maxDecisionMinutes <= 0) {
  fail('rollback.maxDecisionMinutes must be a positive integer.');
}

if (!Array.isArray(review.rollback.triggers) || review.rollback.triggers.length === 0) {
  fail('rollback.triggers must be a non-empty array.');
}

if (!Array.isArray(review.rollback.steps) || review.rollback.steps.length === 0) {
  fail('rollback.steps must be a non-empty array.');
}

if (!Array.isArray(review.rollback.verificationChecks) || review.rollback.verificationChecks.length === 0) {
  fail('rollback.verificationChecks must be a non-empty array.');
}

for (const [fieldName, values] of [
  ['rollback.triggers', review.rollback.triggers],
  ['rollback.steps', review.rollback.steps],
  ['rollback.verificationChecks', review.rollback.verificationChecks],
]) {
  for (const value of values) {
    if (typeof value !== 'string' || value.trim() === '') {
      fail(`${fieldName} must contain non-empty strings.`);
    }
  }
}

if (!review.signoff || typeof review.signoff !== 'object') {
  fail('signoff object is required.');
}

if (!allowedStatus.has(review.signoff.status)) {
  fail('signoff.status must be pending/pass/fail.');
}

if (typeof review.signoff.approvedBy !== 'string') {
  fail('signoff.approvedBy must be a string.');
}

if (typeof review.signoff.approvedAt !== 'string') {
  fail('signoff.approvedAt must be a string.');
}

if (requireFinal) {
  const pendingGate = review.gates.find((gate) => gate.status === 'pending');
  if (pendingGate) {
    fail(`gate ${pendingGate.id} is pending with --require-final.`);
  }

  for (const gate of review.gates) {
    if (gate.checkedAt.trim() === '') {
      fail(`gate ${gate.id} checkedAt must be set with --require-final.`);
    }
  }

  if (review.blockerTriage.triagedAt.trim() === '') {
    fail('blockerTriage.triagedAt must be set with --require-final.');
  }

  if (review.blockerTriage.owner.trim() === '') {
    fail('blockerTriage.owner must be set with --require-final.');
  }

  if (review.rollback.owner.trim() === '') {
    fail('rollback.owner must be set with --require-final.');
  }

  if (review.rollback.notificationChannel.trim() === '') {
    fail('rollback.notificationChannel must be set with --require-final.');
  }

  if (review.signoff.status === 'pending') {
    fail('signoff.status cannot be pending with --require-final.');
  }

  if (review.signoff.approvedBy.trim() === '') {
    fail('signoff.approvedBy must be set with --require-final.');
  }

  if (review.signoff.approvedAt.trim() === '') {
    fail('signoff.approvedAt must be set with --require-final.');
  }

  if (review.signoff.status === 'pass') {
    const failedGate = review.gates.find((gate) => gate.status !== 'pass');
    if (failedGate) {
      fail(`signoff.status cannot be pass while gate ${failedGate.id} is ${failedGate.status}.`);
    }

    if (review.blockerTriage.totalOpen > 0) {
      fail('signoff.status cannot be pass while blockerTriage.totalOpen is greater than zero.');
    }
  }
}

console.log(`[release-readiness] OK: ${filePath}`);
console.log(`[release-readiness] gates: ${review.gates.length}`);
console.log(`[release-readiness] open blockers: ${review.blockerTriage.totalOpen}`);
console.log(`[release-readiness] require-final: ${requireFinal ? 'yes' : 'no'}`);
