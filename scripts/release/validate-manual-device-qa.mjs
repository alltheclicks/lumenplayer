#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const allowedStatus = new Set(['pending', 'pass', 'fail']);
const disallowedTransportModes = new Set(['proxy-remuxed', 'remux-hls']);
const requiredTargetIds = new Set([
  'desktop-chrome-windows',
  'desktop-safari-macos',
  'mobile-chrome-android',
  'mobile-safari-ios',
  'cast-chromecast',
  'airplay-appletv',
  'pwa-install-offline',
]);

const usage = () => {
  console.error('Usage: node scripts/release/validate-manual-device-qa.mjs <file> [--require-final]');
};

const [, , fileArg, ...flags] = process.argv;
if (!fileArg) {
  usage();
  process.exit(1);
}

const requireFinal = flags.includes('--require-final');
const filePath = path.resolve(process.cwd(), fileArg);

const fail = (message) => {
  console.error(`[manual-device-qa] ERROR: ${message}`);
  process.exit(2);
};

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

const validateEvidenceIntake = (intake) => {
  if (!intake || typeof intake !== 'object') {
    fail('evidenceIntake object is required.');
  }

  if (!allowedStatus.has(intake.status)) {
    fail('evidenceIntake.status must be pending/pass/fail.');
  }

  for (const field of ['owner', 'guideRef', 'artifactRef', 'notes']) {
    if (typeof intake[field] !== 'string') {
      fail(`evidenceIntake.${field} must be a string.`);
    }
  }

  if (intake.guideRef !== 'docs/qa/qaf035-real-device-qa-guide.md') {
    fail('evidenceIntake.guideRef must be docs/qa/qaf035-real-device-qa-guide.md.');
  }

  if (intake.artifactRef !== 'artifacts/release/manual-device-qa/qaf035-manual-device-qa-20260603.json') {
    fail('evidenceIntake.artifactRef must be artifacts/release/manual-device-qa/qaf035-manual-device-qa-20260603.json.');
  }

  if (!Array.isArray(intake.requiredTargetIds)) {
    fail('evidenceIntake.requiredTargetIds must be an array.');
  }

  for (const requiredTargetId of requiredTargetIds) {
    if (!intake.requiredTargetIds.includes(requiredTargetId)) {
      fail(`evidenceIntake.requiredTargetIds must include ${requiredTargetId}.`);
    }
  }

  if (!Array.isArray(intake.requiredEvidenceRefs)) {
    fail('evidenceIntake.requiredEvidenceRefs must be an array.');
  }

  for (const requiredRef of [
    'screenshotOrVideoRef',
    'networkEvidenceRef',
    'noMediaScanArtifactRef',
    'perCheckEvidenceRef',
  ]) {
    if (!intake.requiredEvidenceRefs.includes(requiredRef)) {
      fail(`evidenceIntake.requiredEvidenceRefs must include ${requiredRef}.`);
    }
  }

  if (!Array.isArray(intake.finalRules) || intake.finalRules.length === 0) {
    fail('evidenceIntake.finalRules must be a non-empty array.');
  }

  const finalRulesText = intake.finalRules.join('\n').toLowerCase();
  for (const snippet of [
    'playwright/headless',
    'owner',
    'actualdevice',
    'release:no-media-evidence:scan',
    'tracked redacted no-media scan artifact',
    'https',
  ]) {
    if (!finalRulesText.includes(snippet)) {
      fail(`evidenceIntake.finalRules must include ${snippet}.`);
    }
  }

  if (intake.status === 'pending' && !intake.notes.toLowerCase().includes('pending')) {
    fail('evidenceIntake.notes must state pending evidence when status is pending.');
  }

  if (intake.status === 'pass' && !isNonEmptyString(intake.owner)) {
    fail('evidenceIntake.owner must be set when status is pass.');
  }
};

const validateHttpsStagingTunnel = (staging) => {
  if (staging === undefined) {
    return;
  }

  if (!staging || typeof staging !== 'object') {
    fail('httpsStagingTunnel must be an object when present.');
  }

  if (!allowedStatus.has(staging.status)) {
    fail('httpsStagingTunnel.status must be pending/pass/fail.');
  }

  for (const field of ['owner', 'provider', 'allowedHosts', 'notes']) {
    if (!isNonEmptyString(staging[field])) {
      fail(`httpsStagingTunnel.${field} must be a non-empty string.`);
    }
  }

  for (const field of ['appUrl', 'playerUrl', 'proxyOrigin', 'catchupGatewayOrigin']) {
    if (!isNonEmptyString(staging[field]) || !staging[field].startsWith('https://')) {
      fail(`httpsStagingTunnel.${field} must be an HTTPS URL.`);
    }
  }

  if (!isNonEmptyString(staging.proxyHealthCheck) || !staging.proxyHealthCheck.includes(staging.proxyOrigin)) {
    fail('httpsStagingTunnel.proxyHealthCheck must reference proxyOrigin.');
  }
  if (!isNonEmptyString(staging.proxyHealthResult) || !staging.proxyHealthResult.includes('"ok":true')) {
    fail('httpsStagingTunnel.proxyHealthResult must record a healthy proxy response.');
  }
  if (!isNonEmptyString(staging.manifestResult) || !staging.manifestResult.includes('application/manifest+json')) {
    fail('httpsStagingTunnel.manifestResult must record application/manifest+json.');
  }
  if (!isNonEmptyString(staging.receiverResult) || !staging.receiverResult.includes('Lumen Cast Receiver')) {
    fail('httpsStagingTunnel.receiverResult must record the Lumen Cast Receiver page.');
  }

  const evidence = staging.playwrightEvidence;
  if (!evidence || typeof evidence !== 'object') {
    fail('httpsStagingTunnel.playwrightEvidence object is required.');
  }
  if (evidence.result !== 'pass') {
    fail('httpsStagingTunnel.playwrightEvidence.result must be pass.');
  }

  const command = `${staging.runtimeEnvCheck ?? ''} ${evidence.command ?? ''}`;
  for (const snippet of [
    'pnpm e2e:mobile:layout',
    'E2E_MOBILE_LAYOUT_BASE_URL',
    'E2E_MOBILE_LAYOUT_PROXY_ORIGIN',
    'E2E_XTREAM_SERVER=https://gw.castcdn.net:443',
  ]) {
    if (!command.includes(snippet)) {
      fail(`httpsStagingTunnel mobile smoke command must include ${snippet}.`);
    }
  }

  const expectedRefs = {
    json: 'output/playwright/mobile-layout-smoke/report.json',
    report: 'output/playwright/mobile-layout-smoke/REPORT.md',
  };
  for (const [field, expected] of Object.entries(expectedRefs)) {
    if (evidence[field] !== expected) {
      fail(`httpsStagingTunnel.playwrightEvidence.${field} must be ${expected}.`);
    }
  }

  if (!isNonEmptyString(evidence.screenshot) || !evidence.screenshot.startsWith('output/playwright/mobile-layout-smoke/')) {
    fail('httpsStagingTunnel.playwrightEvidence.screenshot must reference output/playwright/mobile-layout-smoke/.');
  }

  const assertions = Array.isArray(evidence.assertions) ? evidence.assertions.join('\n') : '';
  for (const snippet of [
    'runtime env uses https://gw.castcdn.net:443',
    '393px mobile viewport',
    'TV Unazad',
    'remains on /player',
    'no mixed-content',
    'no non-aborted app/proxy request failures',
  ]) {
    if (!assertions.includes(snippet)) {
      fail(`httpsStagingTunnel.playwrightEvidence.assertions must include ${snippet}.`);
    }
  }

  if (!staging.notes.includes('not a substitute for final real-device')) {
    fail('httpsStagingTunnel.notes must state that staging smoke is not final real-device evidence.');
  }
};

const validateNoMediaScanArtifactRef = (targetId, evidenceRef) => {
  const scanArtifactRef = evidenceRef
    .split(/[;\s]+/)
    .find((token) => (
      token.startsWith('artifacts/release/')
      && token.endsWith('.json')
      && token.includes('no-media')
    ));

  if (!scanArtifactRef) {
    fail(`target ${targetId} mediaProcessingAudit.evidenceRef must reference a tracked no-media scan artifact when passing.`);
  }

  const scanArtifactResult = spawnSync(process.execPath, [
    'scripts/release/validate-no-media-evidence-scan-artifact.mjs',
    scanArtifactRef,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  if (scanArtifactResult.status !== 0) {
    const stderr = scanArtifactResult.stderr?.trim();
    const stdout = scanArtifactResult.stdout?.trim();
    fail(`target ${targetId} mediaProcessingAudit linked artifact failed validation${stderr ? `: ${stderr}` : stdout ? `: ${stdout}` : ''}`);
  }
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

if (artifact.policy.requiresRealDeviceEvidence !== true) {
  fail('policy.requiresRealDeviceEvidence must be true.');
}

if (artifact.policy.localChromiumIsNotRealDeviceSignoff !== true) {
  fail('policy.localChromiumIsNotRealDeviceSignoff must be true.');
}

if (artifact.policy.noMediaProcessingRequired !== true) {
  fail('policy.noMediaProcessingRequired must be true.');
}

if (!Array.isArray(artifact.policy.allowedTransportModes) || artifact.policy.allowedTransportModes.length === 0) {
  fail('policy.allowedTransportModes must be a non-empty array.');
}

for (const mode of artifact.policy.allowedTransportModes) {
  if (!isNonEmptyString(mode)) {
    fail('policy.allowedTransportModes must contain non-empty strings.');
  }
  if (disallowedTransportModes.has(mode)) {
    fail(`policy.allowedTransportModes must not include ${mode}.`);
  }
}

if (!Array.isArray(artifact.policy.disallowedTransportModes)) {
  fail('policy.disallowedTransportModes must be an array.');
}

for (const requiredMode of disallowedTransportModes) {
  if (!artifact.policy.disallowedTransportModes.includes(requiredMode)) {
    fail(`policy.disallowedTransportModes must include ${requiredMode}.`);
  }
}

validateEvidenceIntake(artifact.evidenceIntake);

if (!Array.isArray(artifact.targets) || artifact.targets.length === 0) {
  fail('targets must be a non-empty array.');
}

validateHttpsStagingTunnel(artifact.httpsStagingTunnel);

const seenTargetIds = new Set();
let failedTargetCount = 0;
for (const target of artifact.targets) {
  if (!target || typeof target !== 'object') {
    fail('each target must be an object.');
  }

  if (!isNonEmptyString(target.id)) {
    fail('each target requires a non-empty id.');
  }
  if (seenTargetIds.has(target.id)) {
    fail(`duplicate target id: ${target.id}`);
  }
  seenTargetIds.add(target.id);

  for (const field of ['name', 'platform', 'expectedDevice', 'expectedBrowser']) {
    if (!isNonEmptyString(target[field])) {
      fail(`target ${target.id} requires ${field}.`);
    }
  }

  if (!allowedStatus.has(target.status)) {
    fail(`target ${target.id} has invalid status: ${target.status}`);
  }
  if (target.status === 'fail') {
    failedTargetCount += 1;
  }

  for (const field of ['owner', 'actualDevice', 'osVersion', 'browserVersion', 'notes']) {
    if (typeof target[field] !== 'string') {
      fail(`target ${target.id} ${field} must be a string.`);
    }
  }

  if (!Array.isArray(target.evidenceRefs)) {
    fail(`target ${target.id} evidenceRefs must be an array.`);
  }
  for (const evidenceRef of target.evidenceRefs) {
    if (!isNonEmptyString(evidenceRef)) {
      fail(`target ${target.id} evidenceRefs must contain non-empty strings.`);
    }
  }

  if (!target.mediaProcessingAudit || typeof target.mediaProcessingAudit !== 'object') {
    fail(`target ${target.id} mediaProcessingAudit object is required.`);
  }
  if (!allowedStatus.has(target.mediaProcessingAudit.status)) {
    fail(`target ${target.id} mediaProcessingAudit.status is invalid.`);
  }
  if (typeof target.mediaProcessingAudit.evidenceRef !== 'string') {
    fail(`target ${target.id} mediaProcessingAudit.evidenceRef must be a string.`);
  }
  if (!Array.isArray(target.mediaProcessingAudit.forbiddenHits)) {
    fail(`target ${target.id} mediaProcessingAudit.forbiddenHits must be an array.`);
  }
  if (target.mediaProcessingAudit.status === 'pass') {
    if (!target.mediaProcessingAudit.evidenceRef.includes('release:no-media-evidence:scan')) {
      fail(`target ${target.id} mediaProcessingAudit.evidenceRef must reference release:no-media-evidence:scan when passing.`);
    }
    if (target.mediaProcessingAudit.forbiddenHits.length > 0) {
      fail(`target ${target.id} mediaProcessingAudit.forbiddenHits must be empty when passing.`);
    }
    validateNoMediaScanArtifactRef(target.id, target.mediaProcessingAudit.evidenceRef);
  }

  if (!Array.isArray(target.checks) || target.checks.length === 0) {
    fail(`target ${target.id} checks must be a non-empty array.`);
  }

  const seenCheckIds = new Set();
  for (const check of target.checks) {
    if (!check || typeof check !== 'object') {
      fail(`target ${target.id} checks must contain objects.`);
    }
    if (!isNonEmptyString(check.id)) {
      fail(`target ${target.id} check requires a non-empty id.`);
    }
    if (seenCheckIds.has(check.id)) {
      fail(`target ${target.id} duplicate check id: ${check.id}`);
    }
    seenCheckIds.add(check.id);

    if (!isNonEmptyString(check.description)) {
      fail(`target ${target.id} check ${check.id} requires description.`);
    }
    if (!allowedStatus.has(check.status)) {
      fail(`target ${target.id} check ${check.id} has invalid status.`);
    }
    if (typeof check.releaseBlocker !== 'boolean') {
      fail(`target ${target.id} check ${check.id} releaseBlocker must be boolean.`);
    }
    if (typeof check.evidence !== 'string') {
      fail(`target ${target.id} check ${check.id} evidence must be a string.`);
    }
  }

  if (requireFinal) {
    for (const field of ['owner', 'actualDevice', 'osVersion', 'browserVersion']) {
      if (!isNonEmptyString(target[field])) {
        fail(`target ${target.id} ${field} must be set with --require-final.`);
      }
    }

    const finalDeviceText = `${target.actualDevice} ${target.browserVersion}`.toLowerCase();
    if (finalDeviceText.includes('playwright') || finalDeviceText.includes('headless')) {
      fail(`target ${target.id} cannot use Playwright/headless evidence for real-device final signoff.`);
    }

    if (target.evidenceRefs.length === 0) {
      fail(`target ${target.id} evidenceRefs must be set with --require-final.`);
    }
    if (target.mediaProcessingAudit.status === 'pending') {
      fail(`target ${target.id} mediaProcessingAudit is pending with --require-final.`);
    }
    if (target.mediaProcessingAudit.status !== 'pass') {
      fail(`target ${target.id} mediaProcessingAudit must pass with --require-final.`);
    }
    if (!isNonEmptyString(target.mediaProcessingAudit.evidenceRef)) {
      fail(`target ${target.id} mediaProcessingAudit.evidenceRef must be set with --require-final.`);
    }
    if (target.mediaProcessingAudit.forbiddenHits.length > 0) {
      fail(`target ${target.id} mediaProcessingAudit.forbiddenHits must be empty with --require-final.`);
    }

    for (const check of target.checks) {
      if (check.status === 'pending') {
        fail(`target ${target.id} check ${check.id} is pending with --require-final.`);
      }
      if (check.releaseBlocker && check.status !== 'pass') {
        fail(`target ${target.id} release-blocker check ${check.id} is ${check.status}.`);
      }
      if (!isNonEmptyString(check.evidence)) {
        fail(`target ${target.id} check ${check.id} evidence must be set with --require-final.`);
      }
    }
  }
}

for (const requiredTargetId of requiredTargetIds) {
  if (!seenTargetIds.has(requiredTargetId)) {
    fail(`required target is missing: ${requiredTargetId}`);
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
  const pendingTarget = artifact.targets.find((target) => target.status === 'pending');
  if (pendingTarget) {
    fail(`target ${pendingTarget.id} is pending with --require-final.`);
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
  if (artifact.signoff.status === 'pass' && failedTargetCount > 0) {
    fail('signoff.status cannot be pass while any manual device QA target failed.');
  }
}

console.log(`[manual-device-qa] OK: ${filePath}`);
console.log(`[manual-device-qa] targets: ${artifact.targets.length}`);
console.log(`[manual-device-qa] require-final: ${requireFinal ? 'yes' : 'no'}`);
