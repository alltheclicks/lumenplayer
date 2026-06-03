#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const allowedStatus = new Set(['open', 'mitigated', 'closed']);
const allowedSignoffStatus = new Set(['pending', 'pass', 'fail']);
const repoRoot = process.cwd();

const usage = () => {
  console.error('Usage: node scripts/release/validate-beta-closure-plan.mjs <file>');
};

const [, , fileArg] = process.argv;
if (!fileArg) {
  usage();
  process.exit(1);
}

const fail = (message) => {
  console.error(`[beta-closure-plan] ERROR: ${message}`);
  process.exit(2);
};

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const readJson = (fileRef) => {
  const filePath = path.resolve(repoRoot, fileRef);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    fail(`Unable to read/parse JSON file: ${fileRef}`);
  }
};

const sameSet = (actual, expected) => {
  if (actual.size !== expected.size) {
    return false;
  }
  for (const value of expected) {
    if (!actual.has(value)) {
      return false;
    }
  }
  return true;
};

const filePath = path.resolve(repoRoot, fileArg);
let plan;
try {
  plan = JSON.parse(fs.readFileSync(filePath, 'utf8'));
} catch {
  fail(`Unable to read/parse JSON file: ${fileArg}`);
}

if (!isNonEmptyString(plan.release)) {
  fail('release is required.');
}

if (!Number.isInteger(plan.templateVersion) || plan.templateVersion <= 0) {
  fail('templateVersion must be a positive integer.');
}

if (!isNonEmptyString(plan.generatedAt)) {
  fail('generatedAt is required.');
}

if (!isNonEmptyString(plan.owner)) {
  fail('owner is required.');
}

if (!isNonEmptyString(plan.sourceReadinessArtifact)) {
  fail('sourceReadinessArtifact is required.');
}

if (!fs.existsSync(path.resolve(repoRoot, plan.sourceReadinessArtifact))) {
  fail(`sourceReadinessArtifact does not exist: ${plan.sourceReadinessArtifact}`);
}

const readiness = readJson(plan.sourceReadinessArtifact);
const readinessGates = new Set((readiness.gates ?? []).map((gate) => gate.id));
const openBlockers = (readiness.blockerTriage?.items ?? []).filter((item) => item.status === 'open');

if (openBlockers.length === 0) {
  fail('source readiness artifact must have open blockers while using a closure plan.');
}

if (!plan.noMediaInvariant || typeof plan.noMediaInvariant !== 'object') {
  fail('noMediaInvariant object is required.');
}

if (!Array.isArray(plan.noMediaInvariant.allowedOutcomes) || plan.noMediaInvariant.allowedOutcomes.length < 3) {
  fail('noMediaInvariant.allowedOutcomes must contain at least three entries.');
}

for (const outcome of plan.noMediaInvariant.allowedOutcomes) {
  if (!isNonEmptyString(outcome)) {
    fail('noMediaInvariant.allowedOutcomes must contain non-empty strings.');
  }
}

const allowedOutcomesText = plan.noMediaInvariant.allowedOutcomes.join(' ').toLowerCase();
for (const requiredOutcome of ['provider-direct', 'proxy-normalized', 'unsupported']) {
  if (!allowedOutcomesText.includes(requiredOutcome)) {
    fail(`noMediaInvariant.allowedOutcomes must reference ${requiredOutcome}.`);
  }
}

if (!Array.isArray(plan.noMediaInvariant.forbiddenResolution) || plan.noMediaInvariant.forbiddenResolution.length === 0) {
  fail('noMediaInvariant.forbiddenResolution must be a non-empty array.');
}

const forbiddenText = plan.noMediaInvariant.forbiddenResolution.join(' ').toLowerCase();
for (const forbidden of ['ffmpeg', 'ffprobe', 'transcode', 'remux', 'generated hls', 'proxy-remuxed', 'remux-hls', 'xui-side']) {
  if (!forbiddenText.includes(forbidden)) {
    fail(`noMediaInvariant.forbiddenResolution must reference ${forbidden}.`);
  }
}

if (!isNonEmptyString(plan.noMediaInvariant.requiredScannerCommand) || !plan.noMediaInvariant.requiredScannerCommand.includes('release:no-media-evidence:scan')) {
  fail('noMediaInvariant.requiredScannerCommand must reference release:no-media-evidence:scan.');
}

if (!isNonEmptyString(plan.noMediaInvariant.trackedScanArtifact)) {
  fail('noMediaInvariant.trackedScanArtifact is required.');
}

if (!fs.existsSync(path.resolve(repoRoot, plan.noMediaInvariant.trackedScanArtifact))) {
  fail(`noMediaInvariant.trackedScanArtifact does not exist: ${plan.noMediaInvariant.trackedScanArtifact}`);
}

if (!Array.isArray(plan.closureItems) || plan.closureItems.length === 0) {
  fail('closureItems must be a non-empty array.');
}

const openBlockersById = new Map(openBlockers.map((blocker) => [blocker.id, blocker]));
const seenClosureIds = new Set();
const closureByBlockerId = new Map();

for (const item of plan.closureItems) {
  if (!item || typeof item !== 'object') {
    fail('each closureItems entry must be an object.');
  }

  if (!isNonEmptyString(item.id)) {
    fail('each closure item requires id.');
  }

  if (seenClosureIds.has(item.id)) {
    fail(`duplicate closure item id: ${item.id}`);
  }
  seenClosureIds.add(item.id);

  if (!isNonEmptyString(item.blockerId)) {
    fail(`closure item ${item.id} requires blockerId.`);
  }

  if (closureByBlockerId.has(item.blockerId)) {
    fail(`duplicate closure item blockerId: ${item.blockerId}`);
  }
  closureByBlockerId.set(item.blockerId, item);

  const sourceBlocker = openBlockersById.get(item.blockerId);
  if (!sourceBlocker) {
    fail(`closure item ${item.id} references unknown open blockerId: ${item.blockerId}`);
  }

  if (!allowedStatus.has(item.status)) {
    fail(`closure item ${item.id} has invalid status: ${item.status}`);
  }

  if (item.status !== sourceBlocker.status) {
    fail(`closure item ${item.id} status must match source blocker status ${sourceBlocker.status}.`);
  }

  if (!isNonEmptyString(item.owner)) {
    fail(`closure item ${item.id} requires owner.`);
  }

  if (!Array.isArray(item.gateIds) || item.gateIds.length === 0) {
    fail(`closure item ${item.id} gateIds must be a non-empty array.`);
  }

  for (const gateId of item.gateIds) {
    if (!isNonEmptyString(gateId)) {
      fail(`closure item ${item.id} gateIds must contain non-empty strings.`);
    }
    if (!readinessGates.has(gateId)) {
      fail(`closure item ${item.id} references unknown gateId: ${gateId}`);
    }
  }

  const closureGateIds = new Set(item.gateIds);
  const blockerGateIds = new Set(sourceBlocker.gateIds ?? []);
  if (!sameSet(closureGateIds, blockerGateIds)) {
    fail(`closure item ${item.id} gateIds must match source blocker ${item.blockerId}.`);
  }

  if (!Array.isArray(item.artifactRefs) || item.artifactRefs.length === 0) {
    fail(`closure item ${item.id} artifactRefs must be a non-empty array.`);
  }

  for (const artifactRef of item.artifactRefs) {
    if (!isNonEmptyString(artifactRef)) {
      fail(`closure item ${item.id} artifactRefs must contain non-empty strings.`);
    }
    if (!fs.existsSync(path.resolve(repoRoot, artifactRef))) {
      fail(`closure item ${item.id} artifactRef does not exist: ${artifactRef}`);
    }
  }

  for (const [fieldName, minLength] of [
    ['requiredFields', 1],
    ['evidenceRequirements', 1],
    ['validationCommands', 1],
    ['completionCriteria', 1],
  ]) {
    const values = item[fieldName];
    if (!Array.isArray(values) || values.length < minLength) {
      fail(`closure item ${item.id} ${fieldName} must be a non-empty array.`);
    }
    for (const value of values) {
      if (!isNonEmptyString(value)) {
        fail(`closure item ${item.id} ${fieldName} must contain non-empty strings.`);
      }
    }
  }

  for (const command of item.validationCommands) {
    if (/(^|\s)(ffmpeg|ffprobe)(\s|$)/i.test(command)) {
      fail(`closure item ${item.id} validationCommands must not invoke ffmpeg/ffprobe.`);
    }
  }
}

for (const blocker of openBlockers) {
  if (!closureByBlockerId.has(blocker.id)) {
    fail(`open blocker ${blocker.id} must have a closure item.`);
  }
}

if (!plan.signoff || typeof plan.signoff !== 'object') {
  fail('signoff object is required.');
}

if (!allowedSignoffStatus.has(plan.signoff.status)) {
  fail('signoff.status must be pending/pass/fail.');
}

if (typeof plan.signoff.approvedBy !== 'string') {
  fail('signoff.approvedBy must be a string.');
}

if (typeof plan.signoff.approvedAt !== 'string') {
  fail('signoff.approvedAt must be a string.');
}

console.log(`[beta-closure-plan] OK: ${filePath}`);
console.log(`[beta-closure-plan] open blockers covered: ${openBlockers.length}`);
console.log(`[beta-closure-plan] closure items: ${plan.closureItems.length}`);
