#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const allowedSuites = new Set(['smoke', 'regression']);
const allowedStatuses = new Set(['pending', 'pass', 'fail']);
const requiredEvidenceIntakeRefs = [
  'manualDeviceTargetRef',
  'networkEvidenceRef',
  'noMediaScanArtifactRef',
  'perCaseEvidenceRef',
];
const defaultRequiredTags = [
  'desktop-browser',
  'mobile-browser',
  'cast-flow',
  'airplay-flow',
  'pwa-install',
  'pwa-offline',
  'provider-qa',
  'no-media-processing',
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
const repoRoot = process.cwd();
const filePath = path.resolve(repoRoot, fileArg);

const fail = (message) => {
  console.error(`[smoke-matrix] ERROR: ${message}`);
  process.exit(2);
};

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

const isRepoRelativePath = (value) => (
  isNonEmptyString(value)
  && !path.isAbsolute(value)
  && !value.split(/[\\/]/).includes('..')
);

const validateExistingRepoFile = (value, label) => {
  if (!isRepoRelativePath(value)) {
    fail(`evidenceIntake.${label} must be a repo-relative path without parent traversal.`);
  }

  if (!fs.existsSync(path.resolve(repoRoot, value))) {
    fail(`evidenceIntake.${label} must reference an existing file: ${value}`);
  }
};

const validateTrackedNoMediaEvidence = (evidence, label) => {
  if (!evidence.includes('release:no-media-evidence:scan')) {
    fail(`${label} evidence must reference release:no-media-evidence:scan.`);
  }

  const artifactRef = evidence
    .split(/[;\s]+/)
    .find((part) => /^artifacts\/release\/.*no-media.*\.json$/.test(part));

  if (!artifactRef) {
    fail(`${label} evidence must reference a tracked artifacts/release no-media scan artifact.`);
  }

  const result = spawnSync(process.execPath, [
    'scripts/release/validate-no-media-evidence-scan-artifact.mjs',
    artifactRef,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    fail(`${label} no-media scan artifact validation failed${stderr ? `: ${stderr}` : stdout ? `: ${stdout}` : ''}`);
  }
};

const validateEvidenceIntake = (evidenceIntake, { cases, requireFinal: requireFinalMode }) => {
  if (!evidenceIntake || typeof evidenceIntake !== 'object') {
    fail('evidenceIntake object is required.');
  }

  if (!allowedStatuses.has(evidenceIntake.status)) {
    fail('evidenceIntake.status must be one of pending/pass/fail.');
  }

  if (!isNonEmptyString(evidenceIntake.owner)) {
    fail('evidenceIntake.owner must be set.');
  }

  validateExistingRepoFile(evidenceIntake.guideRef, 'guideRef');
  validateExistingRepoFile(evidenceIntake.manualDeviceQaRef, 'manualDeviceQaRef');
  validateExistingRepoFile(evidenceIntake.compatibilityRunRef, 'compatibilityRunRef');
  validateExistingRepoFile(evidenceIntake.noMediaScanArtifactRef, 'noMediaScanArtifactRef');

  if (!String(evidenceIntake.noMediaScanArtifactRef).includes('no-media')) {
    fail('evidenceIntake.noMediaScanArtifactRef must point to a no-media scan artifact.');
  }

  const noMediaScanValidation = spawnSync(process.execPath, [
    'scripts/release/validate-no-media-evidence-scan-artifact.mjs',
    evidenceIntake.noMediaScanArtifactRef,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  if (noMediaScanValidation.status !== 0) {
    const stderr = noMediaScanValidation.stderr?.trim();
    const stdout = noMediaScanValidation.stdout?.trim();
    fail(`evidenceIntake.noMediaScanArtifactRef validation failed${stderr ? `: ${stderr}` : stdout ? `: ${stdout}` : ''}`);
  }

  if (!Array.isArray(evidenceIntake.requiredCaseIds) || evidenceIntake.requiredCaseIds.length === 0) {
    fail('evidenceIntake.requiredCaseIds must be a non-empty array.');
  }

  const caseIds = new Set(cases.map((testCase) => testCase.id));
  const intakeCaseIds = new Set();
  for (const caseId of evidenceIntake.requiredCaseIds) {
    if (!isNonEmptyString(caseId)) {
      fail('evidenceIntake.requiredCaseIds must only include non-empty strings.');
    }
    if (intakeCaseIds.has(caseId)) {
      fail(`evidenceIntake.requiredCaseIds contains duplicate case id: ${caseId}`);
    }
    if (!caseIds.has(caseId)) {
      fail(`evidenceIntake.requiredCaseIds references unknown case id: ${caseId}`);
    }
    intakeCaseIds.add(caseId);
  }

  for (const testCase of cases) {
    if (testCase.status === 'pending' && !intakeCaseIds.has(testCase.id)) {
      fail(`Pending case ${testCase.id} must be listed in evidenceIntake.requiredCaseIds.`);
    }
  }

  if (!Array.isArray(evidenceIntake.requiredEvidenceRefs) || evidenceIntake.requiredEvidenceRefs.length === 0) {
    fail('evidenceIntake.requiredEvidenceRefs must be a non-empty array.');
  }

  const evidenceRefs = new Set(evidenceIntake.requiredEvidenceRefs);
  for (const ref of requiredEvidenceIntakeRefs) {
    if (!evidenceRefs.has(ref)) {
      fail(`evidenceIntake.requiredEvidenceRefs must include ${ref}.`);
    }
  }

  if (!Array.isArray(evidenceIntake.finalRules) || evidenceIntake.finalRules.length === 0) {
    fail('evidenceIntake.finalRules must be a non-empty array.');
  }

  const finalRulesText = evidenceIntake.finalRules.join(' ').toLowerCase();
  if (!finalRulesText.includes('playwright') || !finalRulesText.includes('headless')) {
    fail('evidenceIntake.finalRules must state that local Playwright/headless evidence is not final device evidence.');
  }

  if (!finalRulesText.includes('nomediascanartifactref') && !finalRulesText.includes('no-media')) {
    fail('evidenceIntake.finalRules must require no-media scan evidence.');
  }

  if (!finalRulesText.includes('https') || !finalRulesText.includes('cast') || !finalRulesText.includes('pwa')) {
    fail('evidenceIntake.finalRules must require HTTPS real-target evidence for Cast/PWA flows.');
  }

  if (requireFinalMode) {
    if (evidenceIntake.status !== 'pass') {
      fail('evidenceIntake.status must be pass with --require-final.');
    }

    if (!isNonEmptyString(evidenceIntake.completedBy)) {
      fail('evidenceIntake.completedBy must be set with --require-final.');
    }

    if (!isNonEmptyString(evidenceIntake.completedAt)) {
      fail('evidenceIntake.completedAt must be set with --require-final.');
    }
  }
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

if (Array.isArray(matrix.requiredCoverageTags) && matrix.requiredCoverageTags.length === 0) {
  fail('requiredCoverageTags must contain at least one tag when provided.');
}

const configuredRequiredTags = Array.isArray(matrix.requiredCoverageTags)
  ? matrix.requiredCoverageTags
  : defaultRequiredTags;
const requiredTags = new Set(configuredRequiredTags);

for (const tag of requiredTags) {
  if (typeof tag !== 'string' || tag.trim() === '') {
    fail('requiredCoverageTags must only contain non-empty strings.');
  }
}

const seenIds = new Set();
const seenTags = new Set();
const suiteCoverageByTag = new Map();

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

    const coverage = suiteCoverageByTag.get(tag) ?? { smoke: 0, regression: 0 };
    coverage[testCase.suite] += 1;
    suiteCoverageByTag.set(tag, coverage);
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

  if (requireFinal && !isNonEmptyString(testCase.evidence)) {
    fail(`Case ${testCase.id} evidence must be set with --require-final.`);
  }

  if (testCase.id === 'SMK-PROVIDER-CATCHUP-NO-MEDIA-PROCESSING' && testCase.status === 'pass') {
    validateTrackedNoMediaEvidence(testCase.evidence, `Case ${testCase.id}`);
  }
}

for (const requiredTag of requiredTags) {
  if (!seenTags.has(requiredTag)) {
    fail(`Missing required coverage tag: ${requiredTag}`);
  }

  const coverage = suiteCoverageByTag.get(requiredTag);
  if (!coverage || coverage.smoke === 0) {
    fail(`Required coverage tag "${requiredTag}" is missing smoke suite coverage.`);
  }

  if (!coverage || coverage.regression === 0) {
    fail(`Required coverage tag "${requiredTag}" is missing regression suite coverage.`);
  }
}

validateEvidenceIntake(matrix.evidenceIntake, {
  cases: matrix.cases,
  requireFinal,
});

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
console.log('[smoke-matrix] coverage tags present: yes');
console.log(`[smoke-matrix] require-final: ${requireFinal ? 'yes' : 'no'}`);
