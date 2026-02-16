#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const allowedSuites = new Set(['smoke', 'regression']);
const allowedStatuses = new Set(['pending', 'pass', 'fail']);
const defaultRequiredTags = [
  'desktop-browser',
  'mobile-browser',
  'cast-flow',
  'airplay-flow',
  'pwa-install',
  'pwa-offline',
];

const usage = () => {
  console.error('Usage: node scripts/release/validate-smoke-regression-matrix.mjs <file> [--require-final]');
};

const [, , fileArg, ...flags] = process.argv;
if (!fileArg) {
  usage();
  process.exit(1);
}

const requireFinal = flags.includes('--require-final');
const filePath = path.resolve(process.cwd(), fileArg);

const fail = (message) => {
  console.error(`[smoke-matrix] ERROR: ${message}`);
  process.exit(2);
};

let matrix;
try {
  matrix = JSON.parse(fs.readFileSync(filePath, 'utf8'));
} catch (error) {
  fail(`Unable to read/parse JSON file: ${filePath}`);
}

if (!Array.isArray(matrix.cases) || matrix.cases.length === 0) {
  fail('cases must be a non-empty array.');
}

const configuredRequiredTags = Array.isArray(matrix.requiredCoverageTags) && matrix.requiredCoverageTags.length > 0
  ? matrix.requiredCoverageTags
  : defaultRequiredTags;
const requiredTags = new Set(configuredRequiredTags);

if (requiredTags.size === 0) {
  fail('requiredCoverageTags must contain at least one tag.');
}

for (const tag of requiredTags) {
  if (typeof tag !== 'string' || tag.trim() === '') {
    fail('requiredCoverageTags must only contain non-empty strings.');
  }
}

const seenIds = new Set();
const seenTags = new Set();

for (const testCase of matrix.cases) {
  if (typeof testCase.id !== 'string' || testCase.id.trim() === '') {
    fail('Each test case requires a non-empty id.');
  }

  if (seenIds.has(testCase.id)) {
    fail(`Duplicate test case id found: ${testCase.id}`);
  }
  seenIds.add(testCase.id);

  if (!allowedSuites.has(testCase.suite)) {
    fail(`Case ${testCase.id} has invalid suite: ${testCase.suite}`);
  }

  if (typeof testCase.title !== 'string' || testCase.title.trim() === '') {
    fail(`Case ${testCase.id} requires a non-empty title.`);
  }

  if (!Array.isArray(testCase.tags) || testCase.tags.length === 0) {
    fail(`Case ${testCase.id} must include at least one tag.`);
  }

  for (const tag of testCase.tags) {
    if (typeof tag !== 'string' || tag.trim() === '') {
      fail(`Case ${testCase.id} includes an invalid tag value.`);
    }
    seenTags.add(tag);
  }

  if (!allowedStatuses.has(testCase.status)) {
    fail(`Case ${testCase.id} has invalid status: ${testCase.status}`);
  }

  if (typeof testCase.releaseBlocker !== 'boolean') {
    fail(`Case ${testCase.id} must define releaseBlocker as boolean.`);
  }

  if (requireFinal && testCase.status === 'pending') {
    fail(`Case ${testCase.id} is pending while --require-final is enabled.`);
  }

  if (requireFinal && testCase.releaseBlocker && testCase.status === 'fail') {
    fail(`Release-blocker case ${testCase.id} has status "fail" and cannot be finalized.`);
  }
}

for (const requiredTag of requiredTags) {
  if (!seenTags.has(requiredTag)) {
    fail(`Missing required coverage tag: ${requiredTag}`);
  }
}

if (!matrix.signoff || typeof matrix.signoff !== 'object') {
  fail('signoff object is required.');
}

if (!allowedStatuses.has(matrix.signoff.status)) {
  fail('signoff.status must be one of pending/pass/fail.');
}

if (requireFinal) {
  if (matrix.signoff.status === 'pending') {
    fail('signoff.status cannot be pending with --require-final.');
  }

  if (typeof matrix.signoff.approvedBy !== 'string' || matrix.signoff.approvedBy.trim() === '') {
    fail('signoff.approvedBy must be set with --require-final.');
  }

  if (typeof matrix.signoff.approvedAt !== 'string' || matrix.signoff.approvedAt.trim() === '') {
    fail('signoff.approvedAt must be set with --require-final.');
  }
}

console.log(`[smoke-matrix] OK: ${filePath}`);
console.log(`[smoke-matrix] cases: ${matrix.cases.length}`);
console.log(`[smoke-matrix] coverage tags present: ${Array.from(requiredTags).every((tag) => seenTags.has(tag)) ? 'yes' : 'no'}`);
console.log(`[smoke-matrix] require-final: ${requireFinal ? 'yes' : 'no'}`);
