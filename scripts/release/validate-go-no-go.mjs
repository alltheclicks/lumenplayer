#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const allowedCheckStatuses = new Set(['pending', 'pass', 'fail']);
const allowedDecisionStatuses = new Set(['pending', 'pass', 'fail']);

const usage = () => {
  console.error('Usage: node scripts/release/validate-go-no-go.mjs <file> [--require-final]');
};

const [, , fileArg, ...flags] = process.argv;
if (!fileArg) {
  usage();
  process.exit(1);
}

const requireFinal = flags.includes('--require-final');
const filePath = path.resolve(process.cwd(), fileArg);

const fail = (message) => {
  console.error(`[go-no-go] ERROR: ${message}`);
  process.exit(2);
};

let raw;
try {
  raw = fs.readFileSync(filePath, 'utf8');
} catch (error) {
  fail(`Cannot read file: ${filePath}`);
}

let checklist;
try {
  checklist = JSON.parse(raw);
} catch (error) {
  fail(`Invalid JSON in ${filePath}`);
}

if (!Array.isArray(checklist.featureAreas) || checklist.featureAreas.length === 0) {
  fail('featureAreas must be a non-empty array.');
}

let failedCheckCount = 0;
for (const area of checklist.featureAreas) {
  if (!area || typeof area !== 'object') {
    fail('Each feature area must be an object.');
  }

  if (typeof area.id !== 'string' || area.id.trim() === '') {
    fail('Each feature area must have a non-empty id.');
  }

  if (typeof area.name !== 'string' || area.name.trim() === '') {
    fail(`Feature area ${area.id} must have a non-empty name.`);
  }

  if (typeof area.passWhen !== 'string' || area.passWhen.trim() === '') {
    fail(`Feature area ${area.id} must define passWhen criteria.`);
  }

  if (typeof area.failWhen !== 'string' || area.failWhen.trim() === '') {
    fail(`Feature area ${area.id} must define failWhen criteria.`);
  }

  if (!Array.isArray(area.checks) || area.checks.length === 0) {
    fail(`Feature area ${area.id} must include at least one check.`);
  }

  for (const check of area.checks) {
    if (typeof check.id !== 'string' || check.id.trim() === '') {
      fail(`Feature area ${area.id} contains a check without id.`);
    }

    if (typeof check.description !== 'string' || check.description.trim() === '') {
      fail(`Check ${area.id}/${check.id} must include a description.`);
    }

    if (typeof check.evidence !== 'string') {
      fail(`Check ${area.id}/${check.id} evidence must be a string.`);
    }

    if (!allowedCheckStatuses.has(check.status)) {
      fail(`Check ${area.id}/${check.id} has invalid status: ${check.status}`);
    }

    if (check.status === 'fail') {
      failedCheckCount += 1;
    }

    if (requireFinal && check.status === 'pending') {
      fail(`Check ${area.id}/${check.id} is pending while --require-final is enabled.`);
    }

    if (requireFinal && check.evidence.trim() === '') {
      fail(`Check ${area.id}/${check.id} evidence must be set with --require-final.`);
    }
  }
}

if (!checklist.decision || typeof checklist.decision !== 'object') {
  fail('decision object is required.');
}

if (!allowedDecisionStatuses.has(checklist.decision.status)) {
  fail(`decision.status must be one of: ${Array.from(allowedDecisionStatuses).join(', ')}`);
}

if (requireFinal) {
  if (checklist.decision.status === 'pending') {
    fail('decision.status cannot be pending with --require-final.');
  }

  if (typeof checklist.decision.approvedBy !== 'string' || checklist.decision.approvedBy.trim() === '') {
    fail('decision.approvedBy must be set with --require-final.');
  }

  if (typeof checklist.decision.approvedAt !== 'string' || checklist.decision.approvedAt.trim() === '') {
    fail('decision.approvedAt must be set with --require-final.');
  }

  if (checklist.decision.status === 'pass' && failedCheckCount > 0) {
    fail('decision.status cannot be pass while one or more checks are fail.');
  }
}

console.log(`[go-no-go] OK: ${filePath}`);
console.log(`[go-no-go] feature areas: ${checklist.featureAreas.length}`);
console.log(`[go-no-go] require-final: ${requireFinal ? 'yes' : 'no'}`);
