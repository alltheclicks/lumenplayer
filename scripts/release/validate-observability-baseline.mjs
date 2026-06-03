#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const allowedStatus = new Set(['pending', 'pass', 'fail']);
const requiredEventIds = new Set([
  'playback-started',
  'playback-error',
  'playback-problem-reported',
  'catchup-startup-timeout',
  'cast-error',
]);
const requiredAlertRules = new Map([
  ['web-playback-error-burst', {
    eventName: 'playback.error',
    alertEventName: 'alert.playback-error-burst',
  }],
  ['web-cast-error-burst', {
    eventName: 'cast.error',
    alertEventName: 'alert.cast-error-burst',
  }],
]);
const requiredStopTriggerIds = new Set([
  'startup-slo-breach',
  'playback-failure-burst',
  'provider-error-budget',
  'cast-airplay-release-blocker',
  'no-media-processing-violation',
]);
const forbiddenMediaTerms = [
  'ffmpeg',
  'ffprobe',
  'transcode',
  'remux',
  'generated hls',
  'proxy-remuxed',
  'remux-hls',
  'xui-side media processing',
];

const usage = () => {
  console.error('Usage: node scripts/release/validate-observability-baseline.mjs <file> [--require-final]');
};

const [, , fileArg, ...flags] = process.argv;
if (!fileArg) {
  usage();
  process.exit(1);
}

const requireFinal = flags.includes('--require-final');
const unknownFlags = flags.filter((flag) => flag !== '--require-final');
const repoRoot = process.cwd();
const filePath = path.resolve(repoRoot, fileArg);

const fail = (message) => {
  console.error(`[observability-baseline] ERROR: ${message}`);
  process.exit(2);
};

if (unknownFlags.length > 0) {
  fail(`Unknown flag(s): ${unknownFlags.join(', ')}`);
}

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

const readText = (fileRef) => {
  const absolutePath = path.resolve(repoRoot, fileRef);
  if (!fs.existsSync(absolutePath)) {
    fail(`Referenced file does not exist: ${fileRef}`);
  }
  return fs.readFileSync(absolutePath, 'utf8');
};

const findArtifactRef = (evidence, matcher) => (
  evidence
    .split(/[;\s]+/)
    .find((token) => (
      token.startsWith('artifacts/release/')
      && token.endsWith('.json')
      && matcher(token)
    ))
);

const runLinkedValidator = (label, commandArgs) => {
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    fail(`${label} linked artifact failed validation${stderr ? `: ${stderr}` : stdout ? `: ${stdout}` : ''}`);
  }
};

const validateNoMediaStopEvidence = (evidence) => {
  if (!evidence.includes('release:no-media-evidence:scan')) {
    fail('stop trigger no-media-processing-violation evidence must reference release:no-media-evidence:scan.');
  }

  const scanArtifactRef = findArtifactRef(evidence, (token) => token.includes('no-media'));
  if (!scanArtifactRef) {
    fail('stop trigger no-media-processing-violation evidence must reference a tracked no-media scan artifact.');
  }
  runLinkedValidator('stop trigger no-media-processing-violation evidence', [
    'scripts/release/validate-no-media-evidence-scan-artifact.mjs',
    scanArtifactRef,
  ]);

  const runtimeMediaRef = findArtifactRef(evidence, (token) => token.includes('runtime-media-policy'));
  if (!runtimeMediaRef) {
    fail('stop trigger no-media-processing-violation evidence must reference a runtime media policy artifact.');
  }
  runLinkedValidator('stop trigger no-media-processing-violation evidence', [
    'scripts/release/validate-runtime-media-policy.mjs',
    runtimeMediaRef,
  ]);
};

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

if (!artifact.sourceCoverage || typeof artifact.sourceCoverage !== 'object') {
  fail('sourceCoverage object is required.');
}
if (!allowedStatus.has(artifact.sourceCoverage.status)) {
  fail('sourceCoverage.status must be pending/pass/fail.');
}
if (!isNonEmptyString(artifact.sourceCoverage.testCommand)) {
  fail('sourceCoverage.testCommand must be a non-empty string.');
}
if (!artifact.sourceCoverage.testCommand.includes('pnpm release:observability:test')) {
  fail('sourceCoverage.testCommand must reference pnpm release:observability:test.');
}
if (!Array.isArray(artifact.sourceCoverage.sourceFiles) || artifact.sourceCoverage.sourceFiles.length === 0) {
  fail('sourceCoverage.sourceFiles must be a non-empty array.');
}
const sourceTextByRef = new Map();
for (const sourceRef of artifact.sourceCoverage.sourceFiles) {
  if (!isNonEmptyString(sourceRef)) {
    fail('sourceCoverage.sourceFiles must contain non-empty strings.');
  }
  sourceTextByRef.set(sourceRef, readText(sourceRef));
}

if (!Array.isArray(artifact.sourceCoverage.events) || artifact.sourceCoverage.events.length === 0) {
  fail('sourceCoverage.events must be a non-empty array.');
}
const seenEventIds = new Set();
for (const event of artifact.sourceCoverage.events) {
  if (!event || typeof event !== 'object') {
    fail('sourceCoverage.events must contain objects.');
  }
  for (const field of ['id', 'eventName', 'sourceRef']) {
    if (!isNonEmptyString(event[field])) {
      fail(`each sourceCoverage event requires ${field}.`);
    }
  }
  if (seenEventIds.has(event.id)) {
    fail(`duplicate sourceCoverage event id: ${event.id}`);
  }
  seenEventIds.add(event.id);
  if (!allowedStatus.has(event.status)) {
    fail(`sourceCoverage event ${event.id} has invalid status.`);
  }
  if (typeof event.evidence !== 'string') {
    fail(`sourceCoverage event ${event.id} evidence must be a string.`);
  }

  if (event.status === 'pass') {
    const sourceText = sourceTextByRef.get(event.sourceRef) ?? readText(event.sourceRef);
    if (!sourceText.includes(event.eventName)) {
      fail(`sourceCoverage event ${event.id} sourceRef must contain eventName ${event.eventName}.`);
    }
    if (!event.evidence.includes('pnpm release:observability:test') && !event.evidence.includes(event.sourceRef)) {
      fail(`sourceCoverage event ${event.id} evidence must reference the observability test command or sourceRef.`);
    }
  }
}
for (const requiredEventId of requiredEventIds) {
  if (!seenEventIds.has(requiredEventId)) {
    fail(`required sourceCoverage event is missing: ${requiredEventId}`);
  }
}

if (!Array.isArray(artifact.alertRules) || artifact.alertRules.length === 0) {
  fail('alertRules must be a non-empty array.');
}
const observabilitySource = readText('apps/web/src/services/observability.ts');
const seenAlertRuleIds = new Set();
for (const rule of artifact.alertRules) {
  if (!rule || typeof rule !== 'object') {
    fail('alertRules must contain objects.');
  }
  for (const field of ['id', 'eventName', 'alertEventName']) {
    if (!isNonEmptyString(rule[field])) {
      fail(`each alertRule requires ${field}.`);
    }
  }
  if (seenAlertRuleIds.has(rule.id)) {
    fail(`duplicate alertRule id: ${rule.id}`);
  }
  seenAlertRuleIds.add(rule.id);
  for (const numericField of ['maxEvents', 'windowMs', 'cooldownMs']) {
    if (!Number.isInteger(rule[numericField]) || rule[numericField] <= 0) {
      fail(`alertRule ${rule.id} ${numericField} must be a positive integer.`);
    }
  }
  if (!allowedStatus.has(rule.status)) {
    fail(`alertRule ${rule.id} has invalid status.`);
  }
  if (typeof rule.evidence !== 'string') {
    fail(`alertRule ${rule.id} evidence must be a string.`);
  }

  const expected = requiredAlertRules.get(rule.id);
  if (expected && (rule.eventName !== expected.eventName || rule.alertEventName !== expected.alertEventName)) {
    fail(`alertRule ${rule.id} must map ${expected.eventName} to ${expected.alertEventName}.`);
  }
  if (rule.status === 'pass') {
    for (const snippet of [rule.id, rule.eventName, rule.alertEventName]) {
      if (!observabilitySource.includes(snippet)) {
        fail(`alertRule ${rule.id} source must contain ${snippet}.`);
      }
    }
    if (!rule.evidence.includes('apps/web/src/services/observability')) {
      fail(`alertRule ${rule.id} evidence must reference apps/web/src/services/observability.`);
    }
  }
}
for (const requiredRuleId of requiredAlertRules.keys()) {
  if (!seenAlertRuleIds.has(requiredRuleId)) {
    fail(`required alertRule is missing: ${requiredRuleId}`);
  }
}

if (!artifact.betaRouting || typeof artifact.betaRouting !== 'object') {
  fail('betaRouting object is required.');
}
if (!allowedStatus.has(artifact.betaRouting.status)) {
  fail('betaRouting.status must be pending/pass/fail.');
}
for (const field of ['owner', 'alertChannel', 'dashboardRef', 'responseSlo', 'evidence', 'notes']) {
  if (typeof artifact.betaRouting[field] !== 'string') {
    fail(`betaRouting.${field} must be a string.`);
  }
}

if (!Array.isArray(artifact.stopTriggers) || artifact.stopTriggers.length === 0) {
  fail('stopTriggers must be a non-empty array.');
}
const seenStopTriggerIds = new Set();
let failedStopTriggerCount = 0;
for (const trigger of artifact.stopTriggers) {
  if (!trigger || typeof trigger !== 'object') {
    fail('stopTriggers must contain objects.');
  }
  for (const field of ['id', 'description']) {
    if (!isNonEmptyString(trigger[field])) {
      fail(`each stopTrigger requires ${field}.`);
    }
  }
  if (seenStopTriggerIds.has(trigger.id)) {
    fail(`duplicate stopTrigger id: ${trigger.id}`);
  }
  seenStopTriggerIds.add(trigger.id);
  if (!allowedStatus.has(trigger.status)) {
    fail(`stopTrigger ${trigger.id} has invalid status.`);
  }
  if (trigger.status === 'fail') {
    failedStopTriggerCount += 1;
  }
  for (const field of ['owner', 'evidence']) {
    if (typeof trigger[field] !== 'string') {
      fail(`stopTrigger ${trigger.id} ${field} must be a string.`);
    }
  }
  if (trigger.id === 'no-media-processing-violation') {
    const triggerText = trigger.description.toLowerCase();
    for (const term of forbiddenMediaTerms) {
      if (!triggerText.includes(term)) {
        fail(`stopTrigger no-media-processing-violation description must include ${term}.`);
      }
    }
    if (trigger.status === 'pass') {
      validateNoMediaStopEvidence(trigger.evidence);
    }
  }
}
for (const requiredTriggerId of requiredStopTriggerIds) {
  if (!seenStopTriggerIds.has(requiredTriggerId)) {
    fail(`required stopTrigger is missing: ${requiredTriggerId}`);
  }
}

if (!artifact.signoff || typeof artifact.signoff !== 'object') {
  fail('signoff object is required.');
}
if (!allowedStatus.has(artifact.signoff.status)) {
  fail('signoff.status must be pending/pass/fail.');
}
for (const field of ['approvedBy', 'approvedAt', 'notes']) {
  if (typeof artifact.signoff[field] !== 'string') {
    fail(`signoff.${field} must be a string.`);
  }
}

if (requireFinal) {
  if (artifact.sourceCoverage.status === 'pending') {
    fail('sourceCoverage.status is pending with --require-final.');
  }
  for (const event of artifact.sourceCoverage.events) {
    if (event.status === 'pending') {
      fail(`sourceCoverage event ${event.id} is pending with --require-final.`);
    }
    if (!isNonEmptyString(event.evidence)) {
      fail(`sourceCoverage event ${event.id} evidence must be set with --require-final.`);
    }
  }
  for (const rule of artifact.alertRules) {
    if (rule.status === 'pending') {
      fail(`alertRule ${rule.id} is pending with --require-final.`);
    }
    if (!isNonEmptyString(rule.evidence)) {
      fail(`alertRule ${rule.id} evidence must be set with --require-final.`);
    }
  }
  if (artifact.betaRouting.status === 'pending') {
    fail('betaRouting.status is pending with --require-final.');
  }
  for (const field of ['owner', 'alertChannel', 'dashboardRef', 'responseSlo', 'evidence']) {
    if (!isNonEmptyString(artifact.betaRouting[field])) {
      fail(`betaRouting.${field} must be set with --require-final.`);
    }
  }
  for (const trigger of artifact.stopTriggers) {
    if (trigger.status === 'pending') {
      fail(`stopTrigger ${trigger.id} is pending with --require-final.`);
    }
    if (!isNonEmptyString(trigger.owner)) {
      fail(`stopTrigger ${trigger.id} owner must be set with --require-final.`);
    }
    if (!isNonEmptyString(trigger.evidence)) {
      fail(`stopTrigger ${trigger.id} evidence must be set with --require-final.`);
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
  if (artifact.signoff.status === 'pass') {
    const failedAlertRule = artifact.alertRules.find((rule) => rule.status !== 'pass');
    if (failedAlertRule) {
      fail(`signoff.status cannot be pass while alertRule ${failedAlertRule.id} is ${failedAlertRule.status}.`);
    }
    const failedEvent = artifact.sourceCoverage.events.find((event) => event.status !== 'pass');
    if (failedEvent) {
      fail(`signoff.status cannot be pass while sourceCoverage event ${failedEvent.id} is ${failedEvent.status}.`);
    }
    if (artifact.betaRouting.status !== 'pass') {
      fail(`signoff.status cannot be pass while betaRouting.status is ${artifact.betaRouting.status}.`);
    }
    const failedTrigger = artifact.stopTriggers.find((trigger) => trigger.status !== 'pass');
    if (failedTrigger) {
      fail(`signoff.status cannot be pass while stopTrigger ${failedTrigger.id} is ${failedTrigger.status}.`);
    }
    if (failedStopTriggerCount > 0) {
      fail('signoff.status cannot be pass while any stopTrigger is fail.');
    }
  }
}

console.log(`[observability-baseline] OK: ${filePath}`);
console.log(`[observability-baseline] events: ${artifact.sourceCoverage.events.length}`);
console.log(`[observability-baseline] alert rules: ${artifact.alertRules.length}`);
console.log(`[observability-baseline] stop triggers: ${artifact.stopTriggers.length}`);
console.log(`[observability-baseline] require-final: ${requireFinal ? 'yes' : 'no'}`);
