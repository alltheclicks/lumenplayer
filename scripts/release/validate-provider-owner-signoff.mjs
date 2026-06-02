#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const allowedStatus = new Set(['pending', 'pass', 'fail']);
const disallowedTransportModes = new Set(['proxy-remuxed', 'remux-hls']);
const requiredCheckIds = new Set([
  'provider-owner-identity',
  'provider-account-capacity',
  'xui-no-transcode-remux',
  'catchup-no-generated-hls',
  'rate-limit-rollback-contact',
]);
const forbiddenResolutionTerms = [
  'ffmpeg',
  'ffprobe',
  'transcode',
  'remux',
  'generated hls',
  'xui-side media processing',
  'server-side media processing',
];

const usage = () => {
  console.error('Usage: node scripts/release/validate-provider-owner-signoff.mjs <file> [--require-final]');
};

const [, , fileArg, ...flags] = process.argv;
if (!fileArg) {
  usage();
  process.exit(1);
}

const requireFinal = flags.includes('--require-final');
const filePath = path.resolve(process.cwd(), fileArg);

const fail = (message) => {
  console.error(`[provider-owner] ERROR: ${message}`);
  process.exit(2);
};

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

let artifact;
try {
  artifact = JSON.parse(fs.readFileSync(filePath, 'utf8'));
} catch {
  fail(`Unable to read/parse JSON file: ${filePath}`);
}

if (!artifact.provider || typeof artifact.provider !== 'object') {
  fail('provider object is required.');
}
for (const field of ['name', 'accountScope', 'xuiHostRef', 'ownerName', 'ownerRole', 'contact', 'approvedAt', 'notes']) {
  if (typeof artifact.provider[field] !== 'string') {
    fail(`provider.${field} must be a string.`);
  }
}
if (!Array.isArray(artifact.provider.evidenceRefs)) {
  fail('provider.evidenceRefs must be an array.');
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
if (!isNonEmptyString(artifact.target.trafficModel)) {
  fail('target.trafficModel must be a non-empty string.');
}

if (!artifact.mediaProcessingCommitment || typeof artifact.mediaProcessingCommitment !== 'object') {
  fail('mediaProcessingCommitment object is required.');
}
if (!allowedStatus.has(artifact.mediaProcessingCommitment.status)) {
  fail('mediaProcessingCommitment.status must be pending/pass/fail.');
}
for (const field of ['owner', 'notes']) {
  if (typeof artifact.mediaProcessingCommitment[field] !== 'string') {
    fail(`mediaProcessingCommitment.${field} must be a string.`);
  }
}
if (!Array.isArray(artifact.mediaProcessingCommitment.evidenceRefs)) {
  fail('mediaProcessingCommitment.evidenceRefs must be an array.');
}
if (!Array.isArray(artifact.mediaProcessingCommitment.allowedTransportModes) || artifact.mediaProcessingCommitment.allowedTransportModes.length === 0) {
  fail('mediaProcessingCommitment.allowedTransportModes must be a non-empty array.');
}
for (const mode of artifact.mediaProcessingCommitment.allowedTransportModes) {
  if (!isNonEmptyString(mode)) {
    fail('mediaProcessingCommitment.allowedTransportModes must contain non-empty strings.');
  }
  if (disallowedTransportModes.has(mode)) {
    fail(`mediaProcessingCommitment.allowedTransportModes must not include ${mode}.`);
  }
}
if (!Array.isArray(artifact.mediaProcessingCommitment.disallowedTransportModes)) {
  fail('mediaProcessingCommitment.disallowedTransportModes must be an array.');
}
for (const requiredDisallowed of disallowedTransportModes) {
  if (!artifact.mediaProcessingCommitment.disallowedTransportModes.includes(requiredDisallowed)) {
    fail(`mediaProcessingCommitment.disallowedTransportModes must include ${requiredDisallowed}.`);
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
  if (artifact.mediaProcessingCommitment[field] !== false) {
    fail(`mediaProcessingCommitment.${field} must be false.`);
  }
}
if (!Array.isArray(artifact.mediaProcessingCommitment.forbiddenResolutionPaths) || artifact.mediaProcessingCommitment.forbiddenResolutionPaths.length === 0) {
  fail('mediaProcessingCommitment.forbiddenResolutionPaths must be a non-empty array.');
}
for (const value of artifact.mediaProcessingCommitment.forbiddenResolutionPaths) {
  if (!isNonEmptyString(value)) {
    fail('mediaProcessingCommitment.forbiddenResolutionPaths must contain non-empty strings.');
  }
}
const forbiddenPathText = artifact.mediaProcessingCommitment.forbiddenResolutionPaths.join(' ').toLowerCase();
for (const term of forbiddenResolutionTerms) {
  if (!forbiddenPathText.includes(term.toLowerCase())) {
    fail(`mediaProcessingCommitment.forbiddenResolutionPaths must include ${term}.`);
  }
}

if (!artifact.capacityCommitment || typeof artifact.capacityCommitment !== 'object') {
  fail('capacityCommitment object is required.');
}
if (!allowedStatus.has(artifact.capacityCommitment.status)) {
  fail('capacityCommitment.status must be pending/pass/fail.');
}
for (const field of ['owner', 'accountLimitEvidence', 'upstreamCapacityEvidence', 'rateLimitPolicy', 'rollbackContact', 'notes']) {
  if (typeof artifact.capacityCommitment[field] !== 'string') {
    fail(`capacityCommitment.${field} must be a string.`);
  }
}
if (!Number.isInteger(artifact.capacityCommitment.approvedConcurrentLiveUsers) || artifact.capacityCommitment.approvedConcurrentLiveUsers < 0) {
  fail('capacityCommitment.approvedConcurrentLiveUsers must be a non-negative integer.');
}
if (!Array.isArray(artifact.capacityCommitment.evidenceRefs)) {
  fail('capacityCommitment.evidenceRefs must be an array.');
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
  for (const field of ['name', 'accountScope', 'xuiHostRef', 'ownerName', 'ownerRole', 'contact', 'approvedAt']) {
    if (!isNonEmptyString(artifact.provider[field])) {
      fail(`provider.${field} must be set with --require-final.`);
    }
  }
  if (artifact.provider.evidenceRefs.length === 0) {
    fail('provider.evidenceRefs must be set with --require-final.');
  }

  if (artifact.mediaProcessingCommitment.status === 'pending') {
    fail('mediaProcessingCommitment.status is pending with --require-final.');
  }
  if (!isNonEmptyString(artifact.mediaProcessingCommitment.owner)) {
    fail('mediaProcessingCommitment.owner must be set with --require-final.');
  }
  if (artifact.mediaProcessingCommitment.evidenceRefs.length === 0) {
    fail('mediaProcessingCommitment.evidenceRefs must be set with --require-final.');
  }

  if (artifact.capacityCommitment.status === 'pending') {
    fail('capacityCommitment.status is pending with --require-final.');
  }
  if (!isNonEmptyString(artifact.capacityCommitment.owner)) {
    fail('capacityCommitment.owner must be set with --require-final.');
  }
  if (artifact.capacityCommitment.approvedConcurrentLiveUsers < artifact.target.maxConcurrentLiveUsers) {
    fail('capacityCommitment.approvedConcurrentLiveUsers must cover target.maxConcurrentLiveUsers with --require-final.');
  }
  for (const field of ['accountLimitEvidence', 'upstreamCapacityEvidence', 'rateLimitPolicy', 'rollbackContact']) {
    if (!isNonEmptyString(artifact.capacityCommitment[field])) {
      fail(`capacityCommitment.${field} must be set with --require-final.`);
    }
  }
  if (artifact.capacityCommitment.evidenceRefs.length === 0) {
    fail('capacityCommitment.evidenceRefs must be set with --require-final.');
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
    fail('signoff.status cannot be pass while any provider owner check failed.');
  }
}

console.log(`[provider-owner] OK: ${filePath}`);
console.log(`[provider-owner] checks: ${artifact.checks.length}`);
console.log(`[provider-owner] require-final: ${requireFinal ? 'yes' : 'no'}`);
