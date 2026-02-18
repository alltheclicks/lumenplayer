#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const allowedStatus = new Set(['pending', 'pass', 'fail']);
const requiredScreenIds = new Set(['login', 'player', 'movies', 'series', 'epg']);

const usage = () => {
  console.error('Usage: node scripts/release/validate-design-parity-evidence.mjs <file> [--require-final]');
};

const [, , fileArg, ...flags] = process.argv;
if (!fileArg) {
  usage();
  process.exit(1);
}

const requireFinal = flags.includes('--require-final');
const filePath = path.resolve(process.cwd(), fileArg);

const fail = (message) => {
  console.error(`[design-parity] ERROR: ${message}`);
  process.exit(2);
};

let artifact;
try {
  artifact = JSON.parse(fs.readFileSync(filePath, 'utf8'));
} catch {
  fail(`Unable to read/parse JSON file: ${filePath}`);
}

if (!artifact.sourceOfTruth || typeof artifact.sourceOfTruth !== 'object') {
  fail('sourceOfTruth object is required.');
}

if (typeof artifact.sourceOfTruth.repoPath !== 'string' || artifact.sourceOfTruth.repoPath.trim() === '') {
  fail('sourceOfTruth.repoPath must be a non-empty string.');
}

if (!artifact.sourceOfTruth.repoPath.includes('/balkan-stream')) {
  fail('sourceOfTruth.repoPath must point to the Balkan Stream repository.');
}

if (typeof artifact.sourceOfTruth.referenceManifest !== 'string' || artifact.sourceOfTruth.referenceManifest.trim() === '') {
  fail('sourceOfTruth.referenceManifest must be a non-empty string.');
}

if (typeof artifact.sourceOfTruth.referenceCommit !== 'string' || artifact.sourceOfTruth.referenceCommit.trim() === '') {
  fail('sourceOfTruth.referenceCommit must be a non-empty string.');
}

if (!Array.isArray(artifact.screens) || artifact.screens.length === 0) {
  fail('screens must be a non-empty array.');
}

const validateMode = (screenId, modeName, modeValue) => {
  if (!modeValue || typeof modeValue !== 'object') {
    fail(`screen ${screenId} ${modeName} must be an object.`);
  }

  if (typeof modeValue.referenceRef !== 'string' || modeValue.referenceRef.trim() === '') {
    fail(`screen ${screenId} ${modeName}.referenceRef must be a non-empty string.`);
  }

  if (typeof modeValue.lumenRef !== 'string' || modeValue.lumenRef.trim() === '') {
    fail(`screen ${screenId} ${modeName}.lumenRef must be a non-empty string.`);
  }

  if (!allowedStatus.has(modeValue.status)) {
    fail(`screen ${screenId} ${modeName}.status has invalid value: ${modeValue.status}`);
  }

  if (typeof modeValue.notes !== 'string') {
    fail(`screen ${screenId} ${modeName}.notes must be a string.`);
  }
};

const validateParityReview = (screenId, parityReview) => {
  if (!parityReview || typeof parityReview !== 'object') {
    fail(`screen ${screenId} parityReview must be an object.`);
  }

  if (!allowedStatus.has(parityReview.status)) {
    fail(`screen ${screenId} parityReview.status has invalid value: ${parityReview.status}`);
  }

  if (typeof parityReview.reviewedBy !== 'string') {
    fail(`screen ${screenId} parityReview.reviewedBy must be a string.`);
  }

  if (typeof parityReview.reviewedAt !== 'string') {
    fail(`screen ${screenId} parityReview.reviewedAt must be a string.`);
  }

  if (typeof parityReview.notes !== 'string') {
    fail(`screen ${screenId} parityReview.notes must be a string.`);
  }
};

const seenScreenIds = new Set();
for (const screen of artifact.screens) {
  if (!screen || typeof screen !== 'object') {
    fail('each screen entry must be an object.');
  }

  if (typeof screen.id !== 'string' || screen.id.trim() === '') {
    fail('each screen entry requires a non-empty id.');
  }

  if (seenScreenIds.has(screen.id)) {
    fail(`duplicate screen id: ${screen.id}`);
  }
  seenScreenIds.add(screen.id);

  if (typeof screen.name !== 'string' || screen.name.trim() === '') {
    fail(`screen ${screen.id} requires a non-empty name.`);
  }

  if (typeof screen.route !== 'string' || screen.route.trim() === '') {
    fail(`screen ${screen.id} requires a non-empty route.`);
  }

  validateMode(screen.id, 'desktop', screen.desktop);
  validateMode(screen.id, 'mobile', screen.mobile);
  validateParityReview(screen.id, screen.parityReview);
}

for (const requiredScreenId of requiredScreenIds) {
  if (!seenScreenIds.has(requiredScreenId)) {
    fail(`required screen is missing: ${requiredScreenId}`);
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

if (typeof artifact.signoff.notes !== 'string') {
  fail('signoff.notes must be a string.');
}

if (requireFinal) {
  for (const screen of artifact.screens) {
    if (screen.desktop.status === 'pending') {
      fail(`screen ${screen.id} desktop.status cannot be pending with --require-final.`);
    }

    if (screen.mobile.status === 'pending') {
      fail(`screen ${screen.id} mobile.status cannot be pending with --require-final.`);
    }

    if (screen.parityReview.status === 'pending') {
      fail(`screen ${screen.id} parityReview.status cannot be pending with --require-final.`);
    }

    if (screen.parityReview.status === 'pass') {
      if (screen.parityReview.reviewedBy.trim() === '') {
        fail(`screen ${screen.id} parityReview.reviewedBy must be set when parityReview.status=pass.`);
      }

      if (screen.parityReview.reviewedAt.trim() === '') {
        fail(`screen ${screen.id} parityReview.reviewedAt must be set when parityReview.status=pass.`);
      }
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

  if (artifact.signoff.status === 'pass') {
    for (const screen of artifact.screens) {
      if (screen.desktop.status !== 'pass') {
        fail(`signoff.status cannot be pass while screen ${screen.id} desktop.status=${screen.desktop.status}.`);
      }

      if (screen.mobile.status !== 'pass') {
        fail(`signoff.status cannot be pass while screen ${screen.id} mobile.status=${screen.mobile.status}.`);
      }

      if (screen.parityReview.status !== 'pass') {
        fail(`signoff.status cannot be pass while screen ${screen.id} parityReview.status=${screen.parityReview.status}.`);
      }
    }
  }
}

console.log(`[design-parity] OK: ${filePath}`);
console.log(`[design-parity] screens: ${artifact.screens.length}`);
console.log(`[design-parity] require-final: ${requireFinal ? 'yes' : 'no'}`);
