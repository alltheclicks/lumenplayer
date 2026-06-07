#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const allowedStatus = new Set(['pending', 'pass', 'fail']);
const requiredCheckIds = new Set([
  'provider-capacity-owner',
  'lumen-edge-capacity',
  'no-media-processing-verification',
  'observability-slo',
  'rollback-throttle-plan',
]);
const disallowedTransportModes = new Set(['proxy-remuxed', 'remux-hls']);

const usage = () => {
  console.error('Usage: node scripts/release/validate-beta-capacity-evidence.mjs <file> [--require-final]');
};

const [, , fileArg, ...flags] = process.argv;
if (!fileArg) {
  usage();
  process.exit(1);
}

const requireFinal = flags.includes('--require-final');
const filePath = path.resolve(process.cwd(), fileArg);

const fail = (message) => {
  console.error(`[beta-capacity] ERROR: ${message}`);
  process.exit(2);
};

const findNoMediaScanArtifactRef = (evidence) => (
  evidence
    .split(/[;\s]+/)
    .find((token) => (
      token.startsWith('artifacts/release/')
      && token.endsWith('.json')
      && token.includes('no-media')
    ))
);

const validateNoMediaEvidence = (label, evidence) => {
  if (!evidence.includes('release:no-media-evidence:scan')) {
    fail(`${label} must reference release:no-media-evidence:scan.`);
  }

  const scanArtifactRef = findNoMediaScanArtifactRef(evidence);
  if (!scanArtifactRef) {
    fail(`${label} must reference a tracked no-media scan artifact.`);
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
    fail(`${label} linked artifact failed validation${stderr ? `: ${stderr}` : stdout ? `: ${stdout}` : ''}`);
  }
};

const isHttpsUrl = (value) => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

const isProviderMediaOrApiUrl = (value) => /\/live\/|\/timeshift|player_api\.php/i.test(value);

const validateHttpsStagingEdgeSmoke = (smoke, edgeCapacityCheck) => {
  if (smoke === undefined) {
    return;
  }

  if (!smoke || typeof smoke !== 'object') {
    fail('httpsStagingEdgeSmoke must be an object when present.');
  }

  if (smoke.status !== 'pass') {
    fail('httpsStagingEdgeSmoke.status must be pass when present.');
  }

  for (const field of ['verifiedAt', 'owner', 'scope', 'appUrl', 'proxyUrl', 'command', 'reportRef', 'jsonRef', 'notes']) {
    if (typeof smoke[field] !== 'string' || smoke[field].trim() === '') {
      fail(`httpsStagingEdgeSmoke.${field} must be a non-empty string.`);
    }
  }

  if (!isHttpsUrl(smoke.appUrl)) {
    fail('httpsStagingEdgeSmoke.appUrl must be an HTTPS URL.');
  }

  if (!isHttpsUrl(smoke.proxyUrl)) {
    fail('httpsStagingEdgeSmoke.proxyUrl must be an HTTPS URL.');
  }

  const commandSnippets = [
    'E2E_CAPACITY_APP_URL',
    'E2E_CAPACITY_PROXY_URL',
    'E2E_CAPACITY_REQUESTS',
    'E2E_CAPACITY_CONCURRENCY',
    'pnpm perf:staging-capacity',
  ];
  for (const snippet of commandSnippets) {
    if (!smoke.command.includes(snippet)) {
      fail(`httpsStagingEdgeSmoke.command must include: ${snippet}`);
    }
  }

  if (smoke.reportRef !== 'output/perf/staging-capacity-smoke/REPORT.md') {
    fail('httpsStagingEdgeSmoke.reportRef must be output/perf/staging-capacity-smoke/REPORT.md.');
  }

  if (smoke.jsonRef !== 'output/perf/staging-capacity-smoke/report.json') {
    fail('httpsStagingEdgeSmoke.jsonRef must be output/perf/staging-capacity-smoke/report.json.');
  }

  const scopeText = `${smoke.scope} ${smoke.notes}`.toLowerCase();
  for (const snippet of ['not deployed', 'not a substitute', '300-500', 'no browser automation', 'did not request provider media streams']) {
    if (!scopeText.includes(snippet)) {
      fail(`httpsStagingEdgeSmoke scope/notes must include guardrail: ${snippet}`);
    }
  }

  if (!Number.isInteger(smoke.requestsPerEndpoint) || smoke.requestsPerEndpoint <= 0) {
    fail('httpsStagingEdgeSmoke.requestsPerEndpoint must be a positive integer.');
  }

  if (!Number.isInteger(smoke.concurrencyPerEndpoint) || smoke.concurrencyPerEndpoint <= 0) {
    fail('httpsStagingEdgeSmoke.concurrencyPerEndpoint must be a positive integer.');
  }

  if (!Array.isArray(smoke.endpoints) || smoke.endpoints.length === 0) {
    fail('httpsStagingEdgeSmoke.endpoints must be a non-empty array.');
  }

  const requiredEndpointIds = new Set(['web-player', 'web-manifest', 'cast-receiver', 'proxy-health']);
  const seenEndpointIds = new Set();
  for (const endpoint of smoke.endpoints) {
    if (!endpoint || typeof endpoint !== 'object') {
      fail('each httpsStagingEdgeSmoke endpoint must be an object.');
    }

    if (!requiredEndpointIds.has(endpoint.id)) {
      fail(`httpsStagingEdgeSmoke endpoint has unexpected id: ${endpoint.id}`);
    }
    seenEndpointIds.add(endpoint.id);

    if (typeof endpoint.url !== 'string' || !isHttpsUrl(endpoint.url)) {
      fail(`httpsStagingEdgeSmoke endpoint ${endpoint.id} url must be HTTPS.`);
    }

    if (isProviderMediaOrApiUrl(endpoint.url)) {
      fail(`httpsStagingEdgeSmoke endpoint ${endpoint.id} must not request provider media/API URLs.`);
    }

    for (const field of ['requests', 'concurrency', 'ok', 'failed']) {
      if (!Number.isInteger(endpoint[field]) || endpoint[field] < 0) {
        fail(`httpsStagingEdgeSmoke endpoint ${endpoint.id}.${field} must be a non-negative integer.`);
      }
    }

    for (const field of ['p95Ms', 'p99Ms', 'maxMs']) {
      if (typeof endpoint[field] !== 'number' || !Number.isFinite(endpoint[field]) || endpoint[field] < 0) {
        fail(`httpsStagingEdgeSmoke endpoint ${endpoint.id}.${field} must be a non-negative number.`);
      }
    }

    if (endpoint.requests !== smoke.requestsPerEndpoint) {
      fail(`httpsStagingEdgeSmoke endpoint ${endpoint.id}.requests must match requestsPerEndpoint.`);
    }

    if (endpoint.concurrency !== smoke.concurrencyPerEndpoint) {
      fail(`httpsStagingEdgeSmoke endpoint ${endpoint.id}.concurrency must match concurrencyPerEndpoint.`);
    }

    if (endpoint.failed !== 0 || endpoint.ok !== endpoint.requests) {
      fail(`httpsStagingEdgeSmoke endpoint ${endpoint.id} must have zero failures and ok=requests.`);
    }
  }

  for (const requiredEndpointId of requiredEndpointIds) {
    if (!seenEndpointIds.has(requiredEndpointId)) {
      fail(`httpsStagingEdgeSmoke is missing endpoint: ${requiredEndpointId}`);
    }
  }

  if (edgeCapacityCheck) {
    if (!edgeCapacityCheck.evidence.includes('httpsStagingEdgeSmoke')) {
      fail('check lumen-edge-capacity evidence must reference httpsStagingEdgeSmoke when present.');
    }
    if (!edgeCapacityCheck.evidence.includes(smoke.reportRef)) {
      fail('check lumen-edge-capacity evidence must reference the staging capacity report when present.');
    }
  }
};

const validateDeployedEdgeLoadEvidence = (
  proof,
  artifact,
  edgeCapacityCheck,
  options = {},
) => {
  const { requireFinal: shouldRequireFinal = false } = options;

  if (!proof || typeof proof !== 'object') {
    fail('deployedEdgeLoadEvidence object is required.');
  }

  if (!allowedStatus.has(proof.status)) {
    fail('deployedEdgeLoadEvidence.status must be pending/pass/fail.');
  }

  if (proof.noProviderMediaStreams !== true) {
    fail('deployedEdgeLoadEvidence.noProviderMediaStreams must be true.');
  }

  if (!Number.isInteger(proof.targetConcurrentUsers) || proof.targetConcurrentUsers < artifact.target.minConcurrentLiveUsers) {
    fail('deployedEdgeLoadEvidence.targetConcurrentUsers must be an integer >= target.minConcurrentLiveUsers.');
  }

  if (!Array.isArray(proof.endpoints)) {
    fail('deployedEdgeLoadEvidence.endpoints must be an array.');
  }

  const guardrailText = `${proof.scope ?? ''} ${proof.notes ?? ''}`.toLowerCase();
  for (const snippet of ['deployed', '300-500', 'no provider media streams']) {
    if (!guardrailText.includes(snippet)) {
      fail(`deployedEdgeLoadEvidence scope/notes must include guardrail: ${snippet}`);
    }
  }

  if (proof.status !== 'pass') {
    if (shouldRequireFinal) {
      fail('deployedEdgeLoadEvidence.status must be pass with --require-final.');
    }

    if (proof.status === 'pending' && !guardrailText.includes('pending')) {
      fail('deployedEdgeLoadEvidence pending scope/notes must state that evidence is pending.');
    }
    return;
  }

  for (const field of [
    'owner',
    'environment',
    'deploymentRef',
    'testedAt',
    'appUrl',
    'proxyUrl',
    'loadReportRef',
    'capacityPlanRef',
    'scope',
    'notes',
  ]) {
    if (typeof proof[field] !== 'string' || proof[field].trim() === '') {
      fail(`deployedEdgeLoadEvidence.${field} must be a non-empty string when status is pass.`);
    }
  }

  if (proof.targetConcurrentUsers < artifact.target.maxConcurrentLiveUsers) {
    fail('deployedEdgeLoadEvidence.targetConcurrentUsers must be >= target.maxConcurrentLiveUsers when status is pass.');
  }

  if (typeof proof.durationMinutes !== 'number' || !Number.isFinite(proof.durationMinutes) || proof.durationMinutes <= 0) {
    fail('deployedEdgeLoadEvidence.durationMinutes must be a positive number when status is pass.');
  }

  if (!isHttpsUrl(proof.appUrl)) {
    fail('deployedEdgeLoadEvidence.appUrl must be an HTTPS URL when status is pass.');
  }

  if (!isHttpsUrl(proof.proxyUrl)) {
    fail('deployedEdgeLoadEvidence.proxyUrl must be an HTTPS URL when status is pass.');
  }

  if (proof.endpoints.length === 0) {
    fail('deployedEdgeLoadEvidence.endpoints must be non-empty when status is pass.');
  }

  const requiredEndpointIds = new Set(['web-player', 'web-manifest', 'cast-receiver', 'proxy-health']);
  const seenEndpointIds = new Set();
  for (const endpoint of proof.endpoints) {
    if (!endpoint || typeof endpoint !== 'object') {
      fail('each deployedEdgeLoadEvidence endpoint must be an object.');
    }

    if (typeof endpoint.id !== 'string' || endpoint.id.trim() === '') {
      fail('each deployedEdgeLoadEvidence endpoint requires a non-empty id.');
    }
    seenEndpointIds.add(endpoint.id);

    if (typeof endpoint.url !== 'string' || !isHttpsUrl(endpoint.url)) {
      fail(`deployedEdgeLoadEvidence endpoint ${endpoint.id} url must be HTTPS.`);
    }

    if (isProviderMediaOrApiUrl(endpoint.url)) {
      fail(`deployedEdgeLoadEvidence endpoint ${endpoint.id} must not request provider media/API URLs.`);
    }

    for (const field of ['requests', 'concurrency', 'ok', 'failed']) {
      if (!Number.isInteger(endpoint[field]) || endpoint[field] < 0) {
        fail(`deployedEdgeLoadEvidence endpoint ${endpoint.id}.${field} must be a non-negative integer.`);
      }
    }

    for (const field of ['p95Ms', 'p99Ms', 'maxMs']) {
      if (typeof endpoint[field] !== 'number' || !Number.isFinite(endpoint[field]) || endpoint[field] < 0) {
        fail(`deployedEdgeLoadEvidence endpoint ${endpoint.id}.${field} must be a non-negative number.`);
      }
    }

    if (endpoint.failed !== 0 || endpoint.ok !== endpoint.requests) {
      fail(`deployedEdgeLoadEvidence endpoint ${endpoint.id} must have zero failures and ok=requests.`);
    }
  }

  for (const requiredEndpointId of requiredEndpointIds) {
    if (!seenEndpointIds.has(requiredEndpointId)) {
      fail(`deployedEdgeLoadEvidence is missing endpoint: ${requiredEndpointId}`);
    }
  }

  if (edgeCapacityCheck) {
    if (edgeCapacityCheck.status !== 'pass') {
      fail('check lumen-edge-capacity must be pass when deployedEdgeLoadEvidence.status is pass.');
    }
    if (!edgeCapacityCheck.evidence.includes('deployedEdgeLoadEvidence')) {
      fail('check lumen-edge-capacity evidence must reference deployedEdgeLoadEvidence.');
    }
    if (!edgeCapacityCheck.evidence.includes(proof.loadReportRef)) {
      fail('check lumen-edge-capacity evidence must reference deployedEdgeLoadEvidence.loadReportRef.');
    }
  }
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

if (typeof artifact.target.trafficModel !== 'string' || artifact.target.trafficModel.trim() === '') {
  fail('target.trafficModel must be a non-empty string.');
}

if (!artifact.mediaPath || typeof artifact.mediaPath !== 'object') {
  fail('mediaPath object is required.');
}

if (!Array.isArray(artifact.mediaPath.allowedTransportModes) || artifact.mediaPath.allowedTransportModes.length === 0) {
  fail('mediaPath.allowedTransportModes must be a non-empty array.');
}

for (const mode of artifact.mediaPath.allowedTransportModes) {
  if (typeof mode !== 'string' || mode.trim() === '') {
    fail('mediaPath.allowedTransportModes must contain non-empty strings.');
  }
  if (disallowedTransportModes.has(mode)) {
    fail(`mediaPath.allowedTransportModes must not include ${mode}.`);
  }
}

if (!Array.isArray(artifact.mediaPath.disallowedTransportModes)) {
  fail('mediaPath.disallowedTransportModes must be an array.');
}

for (const requiredDisallowed of disallowedTransportModes) {
  if (!artifact.mediaPath.disallowedTransportModes.includes(requiredDisallowed)) {
    fail(`mediaPath.disallowedTransportModes must include ${requiredDisallowed}.`);
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
  if (artifact.mediaPath[field] !== false) {
    fail(`mediaPath.${field} must be false.`);
  }
}

if (typeof artifact.mediaPath.evidence !== 'string') {
  fail('mediaPath.evidence must be a string.');
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

const noMediaProcessingVerification = artifact.checks.find((check) => (
  check.id === 'no-media-processing-verification'
));
if (noMediaProcessingVerification?.status === 'pass') {
  validateNoMediaEvidence(
    'check no-media-processing-verification evidence',
    noMediaProcessingVerification.evidence,
  );
}

const lumenEdgeCapacity = artifact.checks.find((check) => (
  check.id === 'lumen-edge-capacity'
));
validateHttpsStagingEdgeSmoke(artifact.httpsStagingEdgeSmoke, lumenEdgeCapacity);
validateDeployedEdgeLoadEvidence(artifact.deployedEdgeLoadEvidence, artifact, lumenEdgeCapacity, {
  requireFinal,
});

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
  if (artifact.mediaPath.evidence.trim() === '') {
    fail('mediaPath.evidence must be set with --require-final.');
  }
  validateNoMediaEvidence('mediaPath.evidence', artifact.mediaPath.evidence);

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
    fail('signoff.status cannot be pass while any capacity check is fail.');
  }
}

console.log(`[beta-capacity] OK: ${filePath}`);
console.log(`[beta-capacity] checks: ${artifact.checks.length}`);
console.log(`[beta-capacity] require-final: ${requireFinal ? 'yes' : 'no'}`);
