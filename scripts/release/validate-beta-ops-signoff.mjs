#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const allowedStatus = new Set(['pending', 'pass', 'fail']);
const requiredSignalIds = new Set([
  'startup-health',
  'playback-failure',
  'provider-errors',
  'cast-airplay-failures',
  'no-media-processing-violation',
]);
const requiredCheckIds = new Set([
  'observability-slo-owner',
  'alert-route-ready',
  'rollback-owner-ready',
  'enrollment-throttle-ready',
  'no-media-processing-stop-trigger',
]);
const forbiddenMediaTerms = [
  'ffmpeg',
  'ffprobe',
  'transcode',
  'remux',
  'proxy-remuxed',
  'remux-hls',
  'generated hls',
  'xui-side media processing',
];

const usage = () => {
  console.error('Usage: node scripts/release/validate-beta-ops-signoff.mjs <file> [--require-final]');
};

const [, , fileArg, ...flags] = process.argv;
if (!fileArg) {
  usage();
  process.exit(1);
}

const requireFinal = flags.includes('--require-final');
const filePath = path.resolve(process.cwd(), fileArg);

const fail = (message) => {
  console.error(`[beta-ops] ERROR: ${message}`);
  process.exit(2);
};

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

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
if (!isNonEmptyString(artifact.target.rolloutModel)) {
  fail('target.rolloutModel must be a non-empty string.');
}

if (!artifact.observability || typeof artifact.observability !== 'object') {
  fail('observability object is required.');
}
if (!allowedStatus.has(artifact.observability.status)) {
  fail('observability.status must be pending/pass/fail.');
}
for (const field of ['owner', 'alertChannel', 'dashboardRef', 'notes']) {
  if (typeof artifact.observability[field] !== 'string') {
    fail(`observability.${field} must be a string.`);
  }
}
if (!Array.isArray(artifact.observability.evidenceRefs)) {
  fail('observability.evidenceRefs must be an array.');
}

if (!Array.isArray(artifact.observability.signals) || artifact.observability.signals.length === 0) {
  fail('observability.signals must be a non-empty array.');
}
const seenSignalIds = new Set();
for (const signal of artifact.observability.signals) {
  if (!signal || typeof signal !== 'object') {
    fail('observability.signals must contain objects.');
  }
  if (!isNonEmptyString(signal.id)) {
    fail('each observability signal requires a non-empty id.');
  }
  if (seenSignalIds.has(signal.id)) {
    fail(`duplicate observability signal id: ${signal.id}`);
  }
  seenSignalIds.add(signal.id);

  for (const field of ['name', 'source', 'slo', 'stopTrigger']) {
    if (!isNonEmptyString(signal[field])) {
      fail(`observability signal ${signal.id} requires ${field}.`);
    }
  }
  if (!allowedStatus.has(signal.status)) {
    fail(`observability signal ${signal.id} has invalid status.`);
  }
  if (typeof signal.evidence !== 'string') {
    fail(`observability signal ${signal.id} evidence must be a string.`);
  }
}

for (const requiredSignalId of requiredSignalIds) {
  if (!seenSignalIds.has(requiredSignalId)) {
    fail(`required observability signal is missing: ${requiredSignalId}`);
  }
}

if (!artifact.rollbackThrottle || typeof artifact.rollbackThrottle !== 'object') {
  fail('rollbackThrottle object is required.');
}
if (!allowedStatus.has(artifact.rollbackThrottle.status)) {
  fail('rollbackThrottle.status must be pending/pass/fail.');
}
for (const field of ['owner', 'notificationChannel', 'decisionAuthority', 'notes']) {
  if (typeof artifact.rollbackThrottle[field] !== 'string') {
    fail(`rollbackThrottle.${field} must be a string.`);
  }
}
if (!Number.isInteger(artifact.rollbackThrottle.maxDecisionMinutes) || artifact.rollbackThrottle.maxDecisionMinutes <= 0) {
  fail('rollbackThrottle.maxDecisionMinutes must be a positive integer.');
}
if (!Array.isArray(artifact.rollbackThrottle.triggers) || artifact.rollbackThrottle.triggers.length === 0) {
  fail('rollbackThrottle.triggers must be a non-empty array.');
}
if (!Array.isArray(artifact.rollbackThrottle.throttleSteps) || artifact.rollbackThrottle.throttleSteps.length === 0) {
  fail('rollbackThrottle.throttleSteps must be a non-empty array.');
}
if (!Array.isArray(artifact.rollbackThrottle.rollbackSteps) || artifact.rollbackThrottle.rollbackSteps.length === 0) {
  fail('rollbackThrottle.rollbackSteps must be a non-empty array.');
}
if (!Array.isArray(artifact.rollbackThrottle.verificationChecks) || artifact.rollbackThrottle.verificationChecks.length === 0) {
  fail('rollbackThrottle.verificationChecks must be a non-empty array.');
}

for (const [fieldName, values] of [
  ['rollbackThrottle.triggers', artifact.rollbackThrottle.triggers],
  ['rollbackThrottle.throttleSteps', artifact.rollbackThrottle.throttleSteps],
  ['rollbackThrottle.rollbackSteps', artifact.rollbackThrottle.rollbackSteps],
  ['rollbackThrottle.verificationChecks', artifact.rollbackThrottle.verificationChecks],
]) {
  for (const value of values) {
    if (!isNonEmptyString(value)) {
      fail(`${fieldName} must contain non-empty strings.`);
    }
  }
}

const triggerText = artifact.rollbackThrottle.triggers.join(' ').toLowerCase();
for (const term of forbiddenMediaTerms) {
  if (!triggerText.includes(term.toLowerCase())) {
    fail(`rollbackThrottle.triggers must include stop coverage for ${term}.`);
  }
}

if (!Array.isArray(artifact.checks) || artifact.checks.length === 0) {
  fail('checks must be a non-empty array.');
}
const seenCheckIds = new Set();
let failedCheckCount = 0;
for (const check of artifact.checks) {
  if (!check || typeof check !== 'object') {
    fail('checks must contain objects.');
  }
  if (!isNonEmptyString(check.id)) {
    fail('each check requires a non-empty id.');
  }
  if (seenCheckIds.has(check.id)) {
    fail(`duplicate check id: ${check.id}`);
  }
  seenCheckIds.add(check.id);

  if (!isNonEmptyString(check.description)) {
    fail(`check ${check.id} requires description.`);
  }
  if (!allowedStatus.has(check.status)) {
    fail(`check ${check.id} has invalid status.`);
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
  if (artifact.observability.status === 'pending') {
    fail('observability.status is pending with --require-final.');
  }
  for (const field of ['owner', 'alertChannel', 'dashboardRef']) {
    if (!isNonEmptyString(artifact.observability[field])) {
      fail(`observability.${field} must be set with --require-final.`);
    }
  }
  if (artifact.observability.evidenceRefs.length === 0) {
    fail('observability.evidenceRefs must be set with --require-final.');
  }

  for (const signal of artifact.observability.signals) {
    if (signal.status === 'pending') {
      fail(`observability signal ${signal.id} is pending with --require-final.`);
    }
    if (!isNonEmptyString(signal.evidence)) {
      fail(`observability signal ${signal.id} evidence must be set with --require-final.`);
    }
  }

  if (artifact.rollbackThrottle.status === 'pending') {
    fail('rollbackThrottle.status is pending with --require-final.');
  }
  for (const field of ['owner', 'notificationChannel', 'decisionAuthority']) {
    if (!isNonEmptyString(artifact.rollbackThrottle[field])) {
      fail(`rollbackThrottle.${field} must be set with --require-final.`);
    }
  }

  for (const check of artifact.checks) {
    if (check.status === 'pending') {
      fail(`check ${check.id} is pending with --require-final.`);
    }
    if (!isNonEmptyString(check.owner)) {
      fail(`check ${check.id} owner must be set with --require-final.`);
    }
    if (!isNonEmptyString(check.evidence)) {
      fail(`check ${check.id} evidence must be set with --require-final.`);
    }
  }

  if (artifact.signoff.status === 'pending') {
    fail('signoff.status cannot be pending with --require-final.');
  }
  if (!isNonEmptyString(artifact.signoff.approvedBy)) {
    fail('signoff.approvedBy must be set with --require-final.');
  }
  if (!isNonEmptyString(artifact.signoff.approvedAt)) {
    fail('signoff.approvedAt must be set with --require-final.');
  }
  if (artifact.signoff.status === 'pass' && failedCheckCount > 0) {
    fail('signoff.status cannot be pass while any beta ops check failed.');
  }
}

console.log(`[beta-ops] OK: ${filePath}`);
console.log(`[beta-ops] signals: ${artifact.observability.signals.length}`);
console.log(`[beta-ops] checks: ${artifact.checks.length}`);
console.log(`[beta-ops] require-final: ${requireFinal ? 'yes' : 'no'}`);
