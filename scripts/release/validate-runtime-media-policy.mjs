#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const allowedStatus = new Set(['pending', 'pass', 'fail']);
const disallowedTransportModes = new Set(['proxy-remuxed', 'remux-hls']);
const requiredCheckIds = new Set([
  'web-gateway-rejects-remux',
  'committed-env-no-remux',
  'runtime-process-no-ffmpeg',
  'provider-xui-no-transcode-owner',
]);

const usage = () => {
  console.error('Usage: node scripts/release/validate-runtime-media-policy.mjs <file> [--require-final]');
};

const [, , fileArg, ...flags] = process.argv;
if (!fileArg) {
  usage();
  process.exit(1);
}

const requireFinal = flags.includes('--require-final');
const filePath = path.resolve(process.cwd(), fileArg);

const fail = (message) => {
  console.error(`[runtime-media-policy] ERROR: ${message}`);
  process.exit(2);
};

let artifact;
try {
  artifact = JSON.parse(fs.readFileSync(filePath, 'utf8'));
} catch {
  fail(`Unable to read/parse JSON file: ${filePath}`);
}

if (!artifact.policy || typeof artifact.policy !== 'object') {
  fail('policy object is required.');
}

if (!Array.isArray(artifact.policy.allowedTransportModes) || artifact.policy.allowedTransportModes.length === 0) {
  fail('policy.allowedTransportModes must be a non-empty array.');
}

for (const mode of artifact.policy.allowedTransportModes) {
  if (typeof mode !== 'string' || mode.trim() === '') {
    fail('policy.allowedTransportModes must contain non-empty strings.');
  }
  if (disallowedTransportModes.has(mode)) {
    fail(`policy.allowedTransportModes must not include ${mode}.`);
  }
}

if (!Array.isArray(artifact.policy.disallowedTransportModes)) {
  fail('policy.disallowedTransportModes must be an array.');
}

for (const requiredDisallowed of disallowedTransportModes) {
  if (!artifact.policy.disallowedTransportModes.includes(requiredDisallowed)) {
    fail(`policy.disallowedTransportModes must include ${requiredDisallowed}.`);
  }
}

for (const field of [
  'usesLocalFfmpeg',
  'usesServerSideTranscode',
  'usesServerSideRemux',
  'usesGeneratedHls',
  'usesXuiSideTranscode',
]) {
  if (artifact.policy[field] !== false) {
    fail(`policy.${field} must be false.`);
  }
}

if (!Array.isArray(artifact.policy.forbiddenRuntimeFlags) || artifact.policy.forbiddenRuntimeFlags.length === 0) {
  fail('policy.forbiddenRuntimeFlags must be a non-empty array.');
}

const remuxFlag = artifact.policy.forbiddenRuntimeFlags.find((flag) => (
  flag && flag.name === 'LUMEN_PROXY_REMUX_ENABLED'
));
if (!remuxFlag) {
  fail('policy.forbiddenRuntimeFlags must include LUMEN_PROXY_REMUX_ENABLED.');
}
if (!Array.isArray(remuxFlag.disallowedValues) || !remuxFlag.disallowedValues.includes('1')) {
  fail('LUMEN_PROXY_REMUX_ENABLED disallowedValues must include 1.');
}

if (!Array.isArray(artifact.policy.forbiddenProcesses) || artifact.policy.forbiddenProcesses.length === 0) {
  fail('policy.forbiddenProcesses must be a non-empty array.');
}
for (const processName of ['ffmpeg', 'ffprobe']) {
  if (!artifact.policy.forbiddenProcesses.includes(processName)) {
    fail(`policy.forbiddenProcesses must include ${processName}.`);
  }
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
    fail('signoff.status cannot be pass while any runtime media policy check is fail.');
  }
}

console.log(`[runtime-media-policy] OK: ${filePath}`);
console.log(`[runtime-media-policy] checks: ${artifact.checks.length}`);
console.log(`[runtime-media-policy] require-final: ${requireFinal ? 'yes' : 'no'}`);
