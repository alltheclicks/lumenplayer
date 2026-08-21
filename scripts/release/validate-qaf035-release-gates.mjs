#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const args = process.argv.slice(2);
const requireFinal = args.includes('--require-final');
const unknownFlags = args.filter((arg) => arg !== '--require-final');

const fail = (message) => {
  console.error(`[qaf035-release-gates] ERROR: ${message}`);
  process.exit(2);
};

if (unknownFlags.length > 0) {
  fail(`Unknown flag(s): ${unknownFlags.join(', ')}`);
}

const files = {
  readiness: 'artifacts/release/readiness/qaf035-release-readiness-20260602.json',
  goNoGo: 'artifacts/release/readiness/qaf035-go-no-go-20260603.json',
  smokeMatrix: 'artifacts/release/smoke/qaf035-smoke-regression-matrix-20260603.json',
  compatibility: 'artifacts/release/compatibility/qaf035-provider-local-20260602.json',
  compatibilityTargets: 'scripts/release/v1-compatibility-targets.template.json',
  manualDeviceQa: 'artifacts/release/manual-device-qa/qaf035-manual-device-qa-20260603.json',
  designParity: 'artifacts/release/design/qaf035-design-parity-20260603.json',
  providerOwner: 'artifacts/release/provider/qaf035-provider-owner-signoff-20260603.json',
  betaCapacity: 'artifacts/release/capacity/qaf035-beta-capacity-20260602.json',
  performanceEvidence: 'artifacts/release/performance/qaf035-performance-evidence-20260603.json',
  runtimeMedia: 'artifacts/release/media-policy/qaf035-runtime-media-policy-20260602.json',
  noMediaScanArtifact: 'artifacts/release/media-policy/qaf035-no-media-evidence-scan-20260602.json',
  observabilityBaseline: 'artifacts/release/observability/qaf035-observability-baseline-20260603.json',
  betaOps: 'artifacts/release/ops/qaf035-beta-ops-signoff-20260603.json',
  securityBaseline: 'artifacts/release/security/qaf035-security-privacy-baseline-20260603.json',
  betaClosurePlan: 'artifacts/release/readiness/qaf035-beta-closure-plan-20260603.json',
  runbook: 'docs/release/qaf035-beta-signoff-runbook.md',
  castReadinessGuide: 'docs/qa/google-cast-readiness-guide.md',
  realDeviceQaGuide: 'docs/qa/qaf035-real-device-qa-guide.md',
  prQualityGateWorkflow: '.github/workflows/pr-quality-gate.yml',
  packageJson: 'package.json',
};

const readJson = (filePath) => {
  const absolutePath = path.resolve(repoRoot, filePath);
  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch {
    fail(`Unable to read/parse JSON file: ${filePath}`);
  }
};

const validateRunbook = () => {
  const runbookPath = path.resolve(repoRoot, files.runbook);
  if (!fs.existsSync(runbookPath)) {
    fail(`Runbook is missing: ${files.runbook}`);
  }

  const content = fs.readFileSync(runbookPath, 'utf8');
  const manualDeviceQa = readJson(files.manualDeviceQa);
  const targetIds = manualDeviceQa.targets?.map((target) => target.id) ?? [];
  const requiredSnippets = [
    files.readiness,
    files.goNoGo,
    files.smokeMatrix,
    files.compatibility,
    files.compatibilityTargets,
    files.manualDeviceQa,
    files.designParity,
    files.providerOwner,
    files.betaCapacity,
    files.performanceEvidence,
    files.runtimeMedia,
    files.observabilityBaseline,
    files.betaOps,
    files.securityBaseline,
    files.betaClosurePlan,
    files.castReadinessGuide,
    files.realDeviceQaGuide,
    'pnpm release:qaf035:validate',
    'pnpm release:qaf035:final',
    'pnpm release:no-media-evidence:scan',
    'pnpm release:no-media-scan-artifact:validate',
    'pnpm release:perf-evidence:validate',
    'pnpm release:observability-baseline:validate',
    'pnpm release:security-baseline:validate',
    'pnpm release:beta-closure-plan:validate',
    'pnpm release:cast-readiness:validate',
    'pnpm release:pwa-readiness:validate',
    'pnpm e2e:mobile:layout',
    'output/playwright/mobile-layout-smoke/REPORT.md',
    'pnpm e2e:design:captures',
    'output/playwright/lp-0373/CAPTURE-REPORT.md',
    'pnpm perf:staging-capacity',
    'output/perf/staging-capacity-smoke/REPORT.md',
    'pnpm catchup:timeshift-hls:test',
    'pnpm release:proxy-no-media:validate',
    'pnpm release:proxy-no-media:test',
    'VITE_GOOGLE_CAST_APP_ID',
    'CC1AD845',
    'loadMedia',
    'manifest.webmanifest',
    'offline.html',
    'pwa-install-offline',
    '300-500',
    'ffmpeg',
    'ffprobe',
    'transcode',
    'remux',
    'proxy-remuxed',
    'remux-hls',
    'generated HLS',
    'XUI-side',
    ...targetIds,
    'pnpm release:readiness:validate',
    'pnpm release:provider-owner:validate',
    'pnpm release:beta-capacity:validate',
    'pnpm release:runtime-media:validate',
    'pnpm release:manual-device-qa:validate',
    'pnpm release:beta-ops:validate',
    'pnpm release:cast-readiness:validate',
    'pnpm release:pwa-readiness:validate',
    'concrete QAF-035 artifacts',
    'final proof command',
    'direct, gate-specific final proof command',
    'not a substitute for the concrete artifact validator with `--require-final`',
    'must also be listed in that closure item',
    'final-mode validation for the concrete go/no-go, smoke/regression, compatibility-matrix, and design-parity artifacts',
    '--require-matrix',
    '--require-targets',
    'narrower platform/device/browser/tag profile',
    'case results whose tags no longer match the required target profile',
  ];

  for (const snippet of requiredSnippets) {
    if (!content.includes(snippet)) {
      fail(`Runbook ${files.runbook} must reference: ${snippet}`);
    }
  }

  const forbiddenSnippets = [
    'either the aggregate `pnpm release:qaf035:final` or a concrete artifact validator',
  ];
  for (const snippet of forbiddenSnippets) {
    if (content.includes(snippet)) {
      fail(`Runbook ${files.runbook} must not keep stale closure final-proof guidance: ${snippet}`);
    }
  }
};

const validatePrQualityGateWorkflow = () => {
  const workflowPath = path.resolve(repoRoot, files.prQualityGateWorkflow);
  if (!fs.existsSync(workflowPath)) {
    fail(`PR quality gate workflow is missing: ${files.prQualityGateWorkflow}`);
  }

  const content = fs.readFileSync(workflowPath, 'utf8');
  const requiredSnippets = [
    'release-gates',
    'pnpm test:unit',
    'pnpm security:audit:prod',
    'pnpm release:qaf035:validate',
    'pnpm release:qaf035:test',
    'pnpm release:guardrails:test',
    'pnpm release:no-media-evidence:test',
    'pnpm release:no-media-scan-artifact:validate',
    'pnpm release:perf-evidence:validate',
    'pnpm release:observability-baseline:validate',
    'pnpm release:security-baseline:validate',
    'pnpm release:beta-closure-plan:validate',
    'pnpm release:cast-readiness:validate',
    'pnpm release:pwa-readiness:validate',
    'pnpm catchup:timeshift-hls:test',
    'pnpm release:proxy-no-media:validate',
    'pnpm release:proxy-no-media:test',
  ];

  for (const snippet of requiredSnippets) {
    if (!content.includes(snippet)) {
      fail(`Workflow ${files.prQualityGateWorkflow} must reference: ${snippet}`);
    }
  }
};

const validatePackageScripts = () => {
  const packageJson = readJson(files.packageJson);
  const productUnitTest = packageJson.scripts?.['test:unit'];
  if (productUnitTest !== 'vitest run --config vitest.unit.config.ts') {
    fail('package.json scripts.test:unit must run the product unit-test profile.');
  }

  const productionAudit = packageJson.scripts?.['security:audit:prod'];
  if (productionAudit !== 'pnpm audit --prod --audit-level=moderate') {
    fail('package.json scripts.security:audit:prod must audit production dependencies at moderate severity.');
  }

  const proxyNoMediaValidator = packageJson.scripts?.['release:proxy-no-media:validate'];
  if (typeof proxyNoMediaValidator !== 'string') {
    fail('package.json must define scripts.release:proxy-no-media:validate.');
  }
  if (!proxyNoMediaValidator.includes('scripts/release/validate-proxy-no-media-runtime.mjs')) {
    fail('package.json release:proxy-no-media:validate must reference scripts/release/validate-proxy-no-media-runtime.mjs');
  }

  const proxyNoMediaScript = packageJson.scripts?.['release:proxy-no-media:test'];
  if (typeof proxyNoMediaScript !== 'string') {
    fail('package.json must define scripts.release:proxy-no-media:test.');
  }

  const requiredSnippets = [
    'apps/proxy/src/catchup-remux.test.ts',
    'apps/proxy/src/catchup-gateway.test.ts',
    'apps/proxy/src/server.test.ts',
  ];

  for (const snippet of requiredSnippets) {
    if (!proxyNoMediaScript.includes(snippet)) {
      fail(`package.json release:proxy-no-media:test must reference: ${snippet}`);
    }
  }

  const disabledTimeshiftProbeTest = packageJson.scripts?.['catchup:timeshift-hls:test'];
  if (disabledTimeshiftProbeTest !== 'vitest run scripts/catchup/probe-timeshift-hls.test.ts') {
    fail('package.json scripts.catchup:timeshift-hls:test must run scripts/catchup/probe-timeshift-hls.test.ts.');
  }

  const noMediaScanArtifactValidator = packageJson.scripts?.['release:no-media-scan-artifact:validate'];
  if (noMediaScanArtifactValidator !== `node scripts/release/validate-no-media-evidence-scan-artifact.mjs ${files.noMediaScanArtifact}`) {
    fail(`package.json scripts.release:no-media-scan-artifact:validate must validate ${files.noMediaScanArtifact}.`);
  }

  const goNoGoValidator = packageJson.scripts?.['release:go-no-go:validate'];
  if (goNoGoValidator !== `node scripts/release/validate-go-no-go.mjs ${files.goNoGo}`) {
    fail(`package.json scripts.release:go-no-go:validate must validate ${files.goNoGo}.`);
  }

  const goNoGoTest = packageJson.scripts?.['release:go-no-go:test'];
  if (goNoGoTest !== 'vitest run scripts/release/v1-go-no-go.test.ts') {
    fail('package.json scripts.release:go-no-go:test must run scripts/release/v1-go-no-go.test.ts.');
  }

  const smokeMatrixValidator = packageJson.scripts?.['release:smoke-matrix:validate'];
  if (smokeMatrixValidator !== `node scripts/release/validate-smoke-regression-matrix.mjs ${files.smokeMatrix}`) {
    fail(`package.json scripts.release:smoke-matrix:validate must validate ${files.smokeMatrix}.`);
  }

  const designParityValidator = packageJson.scripts?.['release:design-parity:validate'];
  if (designParityValidator !== `node scripts/release/validate-design-parity-evidence.mjs ${files.designParity}`) {
    fail(`package.json scripts.release:design-parity:validate must validate ${files.designParity}.`);
  }

  const performanceEvidenceValidator = packageJson.scripts?.['release:perf-evidence:validate'];
  if (performanceEvidenceValidator !== `node scripts/release/validate-performance-evidence.mjs ${files.performanceEvidence}`) {
    fail(`package.json scripts.release:perf-evidence:validate must validate ${files.performanceEvidence}.`);
  }

  const betaCapacityValidator = packageJson.scripts?.['release:beta-capacity:validate'];
  if (betaCapacityValidator !== `node scripts/release/validate-beta-capacity-evidence.mjs ${files.betaCapacity}`) {
    fail(`package.json scripts.release:beta-capacity:validate must validate ${files.betaCapacity}.`);
  }

  const runtimeMediaValidator = packageJson.scripts?.['release:runtime-media:validate'];
  if (runtimeMediaValidator !== `node scripts/release/validate-runtime-media-policy.mjs ${files.runtimeMedia}`) {
    fail(`package.json scripts.release:runtime-media:validate must validate ${files.runtimeMedia}.`);
  }

  const manualDeviceQaValidator = packageJson.scripts?.['release:manual-device-qa:validate'];
  if (manualDeviceQaValidator !== `node scripts/release/validate-manual-device-qa.mjs ${files.manualDeviceQa}`) {
    fail(`package.json scripts.release:manual-device-qa:validate must validate ${files.manualDeviceQa}.`);
  }

  const betaOpsValidator = packageJson.scripts?.['release:beta-ops:validate'];
  if (betaOpsValidator !== `node scripts/release/validate-beta-ops-signoff.mjs ${files.betaOps}`) {
    fail(`package.json scripts.release:beta-ops:validate must validate ${files.betaOps}.`);
  }

  const providerOwnerValidator = packageJson.scripts?.['release:provider-owner:validate'];
  if (providerOwnerValidator !== `node scripts/release/validate-provider-owner-signoff.mjs ${files.providerOwner}`) {
    fail(`package.json scripts.release:provider-owner:validate must validate ${files.providerOwner}.`);
  }

  const observabilityBaselineValidator = packageJson.scripts?.['release:observability-baseline:validate'];
  if (observabilityBaselineValidator !== `node scripts/release/validate-observability-baseline.mjs ${files.observabilityBaseline}`) {
    fail(`package.json scripts.release:observability-baseline:validate must validate ${files.observabilityBaseline}.`);
  }

  const observabilityBaselineTest = packageJson.scripts?.['release:observability-baseline:test'];
  if (observabilityBaselineTest !== 'vitest run scripts/release/v1-observability-baseline.test.ts') {
    fail('package.json scripts.release:observability-baseline:test must run scripts/release/v1-observability-baseline.test.ts.');
  }

  const securityBaselineValidator = packageJson.scripts?.['release:security-baseline:validate'];
  if (securityBaselineValidator !== `node scripts/release/validate-security-privacy-baseline.mjs ${files.securityBaseline}`) {
    fail(`package.json scripts.release:security-baseline:validate must validate ${files.securityBaseline}.`);
  }

  const betaClosurePlanValidator = packageJson.scripts?.['release:beta-closure-plan:validate'];
  if (betaClosurePlanValidator !== `node scripts/release/validate-beta-closure-plan.mjs ${files.betaClosurePlan}`) {
    fail(`package.json scripts.release:beta-closure-plan:validate must validate ${files.betaClosurePlan}.`);
  }

  const readinessValidator = packageJson.scripts?.['release:readiness:validate'];
  if (readinessValidator !== `node scripts/release/validate-release-readiness.mjs ${files.readiness}`) {
    fail(`package.json scripts.release:readiness:validate must validate ${files.readiness}.`);
  }

  const mobileLayoutSmoke = packageJson.scripts?.['e2e:mobile:layout'];
  if (mobileLayoutSmoke !== 'node scripts/playwright/run-mobile-layout-smoke.mjs') {
    fail('package.json scripts.e2e:mobile:layout must run scripts/playwright/run-mobile-layout-smoke.mjs.');
  }

  const designParityCaptures = packageJson.scripts?.['e2e:design:captures'];
  if (designParityCaptures !== 'node scripts/playwright/run-design-parity-captures.mjs') {
    fail('package.json scripts.e2e:design:captures must run scripts/playwright/run-design-parity-captures.mjs.');
  }

  const stagingCapacitySmoke = packageJson.scripts?.['perf:staging-capacity'];
  if (stagingCapacitySmoke !== 'node scripts/perf/run-staging-capacity-smoke.mjs') {
    fail('package.json scripts.perf:staging-capacity must run scripts/perf/run-staging-capacity-smoke.mjs.');
  }

  const castReadinessValidator = packageJson.scripts?.['release:cast-readiness:validate'];
  if (castReadinessValidator !== 'node scripts/release/validate-google-cast-readiness.mjs') {
    fail('package.json scripts.release:cast-readiness:validate must run scripts/release/validate-google-cast-readiness.mjs.');
  }

  const castReadinessTest = packageJson.scripts?.['release:cast-readiness:test'];
  if (castReadinessTest !== 'vitest run scripts/release/validate-google-cast-readiness.test.ts') {
    fail('package.json scripts.release:cast-readiness:test must run scripts/release/validate-google-cast-readiness.test.ts.');
  }

  const pwaReadinessValidator = packageJson.scripts?.['release:pwa-readiness:validate'];
  if (pwaReadinessValidator !== 'node scripts/release/validate-pwa-readiness.mjs') {
    fail('package.json scripts.release:pwa-readiness:validate must run scripts/release/validate-pwa-readiness.mjs.');
  }

  const pwaReadinessTest = packageJson.scripts?.['release:pwa-readiness:test'];
  if (pwaReadinessTest !== 'vitest run scripts/release/validate-pwa-readiness.test.ts') {
    fail('package.json scripts.release:pwa-readiness:test must run scripts/release/validate-pwa-readiness.test.ts.');
  }
};

const validateDesignCaptureEvidence = () => {
  const designParity = readJson(files.designParity);
  for (const screen of designParity.screens ?? []) {
    for (const mode of ['desktop', 'mobile']) {
      const entry = screen[mode];
      if (!entry || typeof entry !== 'object') {
        fail(`design parity screen ${screen.id}.${mode} is required.`);
      }
      if (entry.status !== 'pass') {
        fail(`design parity screen ${screen.id}.${mode}.status must be pass after rendered capture refresh.`);
      }
      if (!entry.lumenRef?.startsWith('output/playwright/lp-0373/')) {
        fail(`design parity screen ${screen.id}.${mode}.lumenRef must reference output/playwright/lp-0373/.`);
      }
      if (!entry.notes?.includes('pnpm e2e:design:captures')) {
        fail(`design parity screen ${screen.id}.${mode}.notes must reference pnpm e2e:design:captures.`);
      }
      if (!entry.notes?.includes('owner parity review still pending')) {
        fail(`design parity screen ${screen.id}.${mode}.notes must keep owner parity review pending.`);
      }
    }
    if (screen.parityReview?.status !== 'pending') {
      fail(`design parity screen ${screen.id}.parityReview.status must remain pending until owner review.`);
    }
  }

  if (!designParity.signoff?.notes?.includes('owner parity review and approval')) {
    fail('design parity signoff notes must keep owner parity review and approval pending.');
  }
};

const validateMobileStagingSmokeEvidence = () => {
  const manualDeviceQa = readJson(files.manualDeviceQa);
  const httpsStaging = manualDeviceQa.httpsStagingTunnel;
  if (!httpsStaging || typeof httpsStaging !== 'object') {
    fail(`${files.manualDeviceQa} must include httpsStagingTunnel evidence.`);
  }

  const requiredHttpsFields = ['appUrl', 'playerUrl', 'proxyOrigin', 'catchupGatewayOrigin'];
  for (const field of requiredHttpsFields) {
    const value = httpsStaging[field];
    if (typeof value !== 'string' || !value.startsWith('https://')) {
      fail(`manual-device QA httpsStagingTunnel.${field} must be an HTTPS URL.`);
    }
  }

  if (httpsStaging.status !== 'pass') {
    fail('manual-device QA httpsStagingTunnel.status must be pass for prepared staging smoke evidence.');
  }

  const command = httpsStaging.playwrightEvidence?.command ?? httpsStaging.runtimeEnvCheck ?? '';
  const requiredCommandSnippets = [
    'pnpm e2e:mobile:layout',
    'E2E_MOBILE_LAYOUT_BASE_URL',
    'E2E_MOBILE_LAYOUT_PROXY_ORIGIN',
    'E2E_XTREAM_SERVER=https://gw.castcdn.net:443',
  ];
  for (const snippet of requiredCommandSnippets) {
    if (!command.includes(snippet)) {
      fail(`manual-device QA mobile staging smoke command must include: ${snippet}`);
    }
  }

  const evidence = httpsStaging.playwrightEvidence;
  if (!evidence || typeof evidence !== 'object') {
    fail('manual-device QA httpsStagingTunnel.playwrightEvidence is required.');
  }

  const expectedRefs = new Map([
    ['json', 'output/playwright/mobile-layout-smoke/report.json'],
    ['report', 'output/playwright/mobile-layout-smoke/REPORT.md'],
  ]);
  for (const [field, expected] of expectedRefs.entries()) {
    if (evidence[field] !== expected) {
      fail(`manual-device QA httpsStagingTunnel.playwrightEvidence.${field} must be ${expected}.`);
    }
  }

  const assertions = Array.isArray(evidence.assertions) ? evidence.assertions.join('\n') : '';
  const requiredAssertionSnippets = [
    'runtime env uses https://gw.castcdn.net:443',
    '393px mobile viewport',
    'TV Unazad',
    'remains on /player',
    'no mixed-content',
    'no non-aborted app/proxy request failures',
  ];
  for (const snippet of requiredAssertionSnippets) {
    if (!assertions.includes(snippet)) {
      fail(`manual-device QA mobile staging assertions must include: ${snippet}`);
    }
  }

  const notes = `${httpsStaging.notes ?? ''} ${manualDeviceQa.signoff?.notes ?? ''}`;
  if (!notes.includes('not a substitute for final real-device')) {
    fail('manual-device QA staging notes must state that staging smoke is not final real-device evidence.');
  }
};

const validateCapacityStagingSmokeEvidence = () => {
  const betaCapacity = readJson(files.betaCapacity);
  const httpsStaging = betaCapacity.httpsStagingEdgeSmoke;
  if (!httpsStaging || typeof httpsStaging !== 'object') {
    fail(`${files.betaCapacity} must include httpsStagingEdgeSmoke evidence.`);
  }

  if (httpsStaging.status !== 'pass') {
    fail('beta capacity httpsStagingEdgeSmoke.status must be pass for prepared staging smoke evidence.');
  }

  for (const field of ['appUrl', 'proxyUrl']) {
    const value = httpsStaging[field];
    if (typeof value !== 'string' || !value.startsWith('https://')) {
      fail(`beta capacity httpsStagingEdgeSmoke.${field} must be an HTTPS URL.`);
    }
  }

  const command = httpsStaging.command ?? '';
  for (const snippet of [
    'E2E_CAPACITY_APP_URL',
    'E2E_CAPACITY_PROXY_URL',
    'E2E_CAPACITY_REQUESTS',
    'E2E_CAPACITY_CONCURRENCY',
    'pnpm perf:staging-capacity',
  ]) {
    if (!command.includes(snippet)) {
      fail(`beta capacity staging smoke command must include: ${snippet}`);
    }
  }

  if (httpsStaging.reportRef !== 'output/perf/staging-capacity-smoke/REPORT.md') {
    fail('beta capacity httpsStagingEdgeSmoke.reportRef must be output/perf/staging-capacity-smoke/REPORT.md.');
  }

  if (httpsStaging.jsonRef !== 'output/perf/staging-capacity-smoke/report.json') {
    fail('beta capacity httpsStagingEdgeSmoke.jsonRef must be output/perf/staging-capacity-smoke/report.json.');
  }

  const notes = `${httpsStaging.scope ?? ''} ${httpsStaging.notes ?? ''}`;
  for (const snippet of ['not a substitute', '300-500', 'did not request provider media streams']) {
    if (!notes.includes(snippet)) {
      fail(`beta capacity staging smoke notes must include: ${snippet}`);
    }
  }

  const endpoints = Array.isArray(httpsStaging.endpoints) ? httpsStaging.endpoints : [];
  const endpointIds = new Set(endpoints.map((endpoint) => endpoint.id));
  for (const requiredEndpointId of ['web-player', 'web-manifest', 'cast-receiver', 'proxy-health']) {
    if (!endpointIds.has(requiredEndpointId)) {
      fail(`beta capacity staging smoke is missing endpoint: ${requiredEndpointId}`);
    }
  }

  for (const endpoint of endpoints) {
    if (endpoint.failed !== 0 || endpoint.ok !== endpoint.requests) {
      fail(`beta capacity staging smoke endpoint ${endpoint.id} must have zero failures and ok=requests.`);
    }
  }

  const edgeCapacityCheck = betaCapacity.checks?.find((check) => check.id === 'lumen-edge-capacity');
  if (!edgeCapacityCheck?.evidence?.includes('httpsStagingEdgeSmoke')) {
    fail('beta capacity lumen-edge-capacity evidence must reference httpsStagingEdgeSmoke.');
  }
  if (!edgeCapacityCheck?.evidence?.includes('deployedEdgeLoadEvidence')) {
    fail('beta capacity lumen-edge-capacity evidence must reference deployedEdgeLoadEvidence.');
  }
  if (edgeCapacityCheck?.status !== 'pending') {
    fail('beta capacity lumen-edge-capacity must remain pending until deployed 300-500 edge/load proof exists.');
  }

  const deployedLoad = betaCapacity.deployedEdgeLoadEvidence;
  if (!deployedLoad || typeof deployedLoad !== 'object') {
    fail('beta capacity must include deployedEdgeLoadEvidence.');
  }
  if (deployedLoad.status !== 'pending') {
    fail('beta capacity deployedEdgeLoadEvidence must remain pending until deployed 300-500 edge/load proof exists.');
  }
  if (deployedLoad.noProviderMediaStreams !== true) {
    fail('beta capacity deployedEdgeLoadEvidence.noProviderMediaStreams must be true.');
  }
  if (
    !Number.isInteger(deployedLoad.targetConcurrentUsers) ||
    deployedLoad.targetConcurrentUsers < betaCapacity.target.maxConcurrentLiveUsers
  ) {
    fail('beta capacity deployedEdgeLoadEvidence.targetConcurrentUsers must cover target.maxConcurrentLiveUsers.');
  }
  const deployedNotes = `${deployedLoad.scope ?? ''} ${deployedLoad.notes ?? ''}`;
  for (const snippet of ['pending', 'deployed', '300-500', 'no provider media streams', 'localEdgeSmoke', 'httpsStagingEdgeSmoke']) {
    if (!deployedNotes.includes(snippet)) {
      fail(`beta capacity deployedEdgeLoadEvidence notes must include: ${snippet}`);
    }
  }
};

const checks = [];
const expectedFinalValidationFailures = [];
const failures = [];

const runNode = (label, commandArgs, options = {}) => {
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const stdout = result.stdout?.trim() ?? '';
  const stderr = result.stderr?.trim() ?? '';

  if (options.expectFailure) {
    if (result.status === 0) {
      failures.push(`${label} was expected to fail but passed.`);
      return;
    }

    const firstLine = (stderr || stdout).split(/\r?\n/).find(Boolean) ?? 'failed as expected';
    expectedFinalValidationFailures.push(`${label}: ${firstLine}`);
    return;
  }

  if (result.status !== 0) {
    failures.push(`${label} failed${stderr ? `: ${stderr}` : stdout ? `: ${stdout}` : ''}`);
    return;
  }

  checks.push(label);
};

validateRunbook();
checks.push('qaf035-beta-signoff-runbook');
validatePrQualityGateWorkflow();
checks.push('pr-quality-gate-workflow');
validatePackageScripts();
checks.push('package-scripts');
validateMobileStagingSmokeEvidence();
checks.push('mobile staging smoke evidence');
validateDesignCaptureEvidence();
checks.push('design capture evidence');
validateCapacityStagingSmokeEvidence();
checks.push('capacity staging smoke evidence');

runNode('release readiness artifact', [
  'scripts/release/validate-release-readiness.mjs',
  files.readiness,
]);

runNode('release evidence links', [
  'scripts/release/validate-release-evidence-links.mjs',
  files.readiness,
  ...(requireFinal ? [] : ['--expect-open-blockers']),
]);

runNode('release secret hygiene', [
  'scripts/release/validate-release-secret-hygiene.mjs',
]);

runNode('compatibility matrix status', [
  'scripts/release/compatibility-matrix-task.mjs',
  'status',
  '--run',
  files.compatibility,
]);

runNode('proxy no-media runtime guard', [
  'scripts/release/validate-proxy-no-media-runtime.mjs',
]);

runNode('no-media scan artifact', [
  'scripts/release/validate-no-media-evidence-scan-artifact.mjs',
  files.noMediaScanArtifact,
]);

runNode('performance evidence', [
  'scripts/release/validate-performance-evidence.mjs',
  files.performanceEvidence,
]);

runNode('observability baseline', [
  'scripts/release/validate-observability-baseline.mjs',
  files.observabilityBaseline,
]);

runNode('security/privacy baseline', [
  'scripts/release/validate-security-privacy-baseline.mjs',
  files.securityBaseline,
]);

runNode('beta blocker closure plan', [
  'scripts/release/validate-beta-closure-plan.mjs',
  files.betaClosurePlan,
]);

runNode('google cast readiness guard', [
  'scripts/release/validate-google-cast-readiness.mjs',
]);

runNode('pwa readiness guard', [
  'scripts/release/validate-pwa-readiness.mjs',
]);

const finalValidators = [
  ['final go/no-go checklist', ['scripts/release/validate-go-no-go.mjs', files.goNoGo, '--require-final']],
  ['final smoke/regression matrix', ['scripts/release/validate-smoke-regression-matrix.mjs', files.smokeMatrix, '--require-final']],
  ['final compatibility matrix', ['scripts/release/compatibility-matrix-task.mjs', 'status', '--run', files.compatibility, '--require-final', '--require-matrix', files.smokeMatrix, '--require-targets', files.compatibilityTargets]],
  ['final design parity evidence', ['scripts/release/validate-design-parity-evidence.mjs', files.designParity, '--require-final']],
  ['final release readiness', ['scripts/release/validate-release-readiness.mjs', files.readiness, '--require-final']],
  ['final provider owner signoff', ['scripts/release/validate-provider-owner-signoff.mjs', files.providerOwner, '--require-final']],
  ['final beta capacity evidence', ['scripts/release/validate-beta-capacity-evidence.mjs', files.betaCapacity, '--require-final']],
  ['final performance evidence', ['scripts/release/validate-performance-evidence.mjs', files.performanceEvidence, '--require-final']],
  ['final runtime media policy', ['scripts/release/validate-runtime-media-policy.mjs', files.runtimeMedia, '--require-final']],
  ['final observability baseline', ['scripts/release/validate-observability-baseline.mjs', files.observabilityBaseline, '--require-final']],
  ['final manual device QA', ['scripts/release/validate-manual-device-qa.mjs', files.manualDeviceQa, '--require-final']],
  ['final beta ops signoff', ['scripts/release/validate-beta-ops-signoff.mjs', files.betaOps, '--require-final']],
  ['final security/privacy baseline', ['scripts/release/validate-security-privacy-baseline.mjs', files.securityBaseline, '--require-final']],
];
const expectedCurrentFinalFailureLabels = new Set([
  'final go/no-go checklist',
  'final smoke/regression matrix',
  'final compatibility matrix',
  'final design parity evidence',
  'final release readiness',
  'final beta capacity evidence',
  'final manual device QA',
]);

for (const [label, commandArgs] of finalValidators) {
  runNode(label, commandArgs, {
    expectFailure: !requireFinal && expectedCurrentFinalFailureLabels.has(label),
  });
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`[qaf035-release-gates] ${failure}`);
  }
  fail(`${failures.length} release gate validation failure(s).`);
}

console.log(`[qaf035-release-gates] mode: ${requireFinal ? 'require-final' : 'current-open-blockers'}`);
console.log(`[qaf035-release-gates] checks passed: ${checks.length}`);
for (const check of checks) {
  console.log(`- ${check}`);
}
if (expectedFinalValidationFailures.length > 0) {
  console.log('[qaf035-release-gates] expected final validation failures:');
  for (const validationFailure of expectedFinalValidationFailures) {
    console.log(`- ${validationFailure}`);
  }
}
console.log('[qaf035-release-gates] OK');
