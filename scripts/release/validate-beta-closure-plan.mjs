#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const allowedStatus = new Set(['open', 'mitigated', 'closed']);
const allowedSignoffStatus = new Set(['pending', 'pass', 'fail']);
const repoRoot = process.cwd();
const forbiddenMediaToolReferencePattern = /(^|[^a-z0-9_-])(ffmpeg|ffprobe)([^a-z0-9_-]|$)/i;
const forbiddenMediaProcessingCommandPatterns = [
  ['LUMEN_PROXY_REMUX_ENABLED', /\bLUMEN_PROXY_REMUX_ENABLED\b/i],
  ['__remux__', /__remux__/i],
  ['remux-hls', /remux[-_]hls/i],
  ['proxy-remuxed', /proxy[-_]remuxed/i],
  ['XUI-side media processing', /\bxui(?:[-_\s]*side)?[-_\s]*(?:media[-_\s]*processing|transcod(?:e|ing|er)?|remux)\b/i],
  ['server-side media processing', /\bserver[-_\s]*side[-_\s]*(?:media[-_\s]*processing|transcod(?:e|ing|er)?|remux)\b/i],
  ['generated HLS', /\b(?:generated|generating|generate)[-_\s]+hls\b/i],
  ['transcode', /transcod(?:e|ing|er)?/i],
];

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
const isRepoRelativePath = (value) => (
  isNonEmptyString(value)
  && !path.isAbsolute(value)
  && !value.split(/[\\/]/).includes('..')
);
const shellControlPattern = /(?:&&|\|\||[;|<>`]|\$\()/;
const isPathLikeCommandArg = (value) => (
  value.includes('/')
  || /\.(?:json|mjs|md)$/i.test(value)
);
const finalProofFileArgsExist = (parts) => (
  parts.every((part) => (
    part.startsWith('--')
    || !isPathLikeCommandArg(part)
    || (
      isRepoRelativePath(part)
      && fs.existsSync(path.resolve(repoRoot, part))
    )
  ))
);
const commandParts = (command) => command.trim().split(/\s+/).filter(Boolean);
const allowedFinalProofScripts = new Set([
  'scripts/release/compatibility-matrix-task.mjs',
  'scripts/release/validate-beta-capacity-evidence.mjs',
  'scripts/release/validate-beta-ops-signoff.mjs',
  'scripts/release/validate-design-parity-evidence.mjs',
  'scripts/release/validate-go-no-go.mjs',
  'scripts/release/validate-manual-device-qa.mjs',
  'scripts/release/validate-observability-baseline.mjs',
  'scripts/release/validate-performance-evidence.mjs',
  'scripts/release/validate-provider-owner-signoff.mjs',
  'scripts/release/validate-qaf035-release-gates.mjs',
  'scripts/release/validate-release-readiness.mjs',
  'scripts/release/validate-runtime-media-policy.mjs',
  'scripts/release/validate-security-privacy-baseline.mjs',
  'scripts/release/validate-smoke-regression-matrix.mjs',
]);
const isConcreteFinalProofCommand = (command) => {
  if (shellControlPattern.test(command)) {
    return false;
  }

  const parts = commandParts(command);
  if (parts.length === 2 && parts[0] === 'pnpm' && parts[1] === 'release:qaf035:final') {
    return true;
  }

  if (parts.length < 3 || parts[0] !== 'node') {
    return false;
  }

  const scriptRef = parts[1];
  return (
    allowedFinalProofScripts.has(scriptRef)
    && isRepoRelativePath(scriptRef)
    && fs.existsSync(path.resolve(repoRoot, scriptRef))
    && finalProofFileArgsExist(parts.slice(1))
    && parts.includes('--require-final')
  );
};
const commandPartsIncludeAll = (parts, requiredParts) => (
  requiredParts.every((requiredPart) => parts.includes(requiredPart))
);
const matchesFinalScript = (scriptRef, requiredParts = []) => (command) => {
  const parts = commandParts(command);
  return (
    isConcreteFinalProofCommand(command)
    && parts[0] === 'node'
    && parts[1] === scriptRef
    && commandPartsIncludeAll(parts, [scriptRef, '--require-final', ...requiredParts])
  );
};
const requiredFinalProofByGate = new Map([
  [
    'go-no-go-checklist',
    {
      label: 'go/no-go final proof',
      matches: matchesFinalScript('scripts/release/validate-go-no-go.mjs', [
        'artifacts/release/readiness/qaf035-go-no-go-20260603.json',
      ]),
    },
  ],
  [
    'smoke-regression-matrix',
    {
      label: 'smoke/regression final proof',
      matches: matchesFinalScript('scripts/release/validate-smoke-regression-matrix.mjs', [
        'artifacts/release/smoke/qaf035-smoke-regression-matrix-20260603.json',
      ]),
    },
  ],
  [
    'compatibility-matrix',
    {
      label: 'compatibility final matrix with required targets',
      matches: matchesFinalScript('scripts/release/compatibility-matrix-task.mjs', [
        'status',
        '--run',
        'artifacts/release/compatibility/qaf035-provider-local-20260602.json',
        '--require-matrix',
        'artifacts/release/smoke/qaf035-smoke-regression-matrix-20260603.json',
        '--require-targets',
        'scripts/release/v1-compatibility-targets.template.json',
      ]),
    },
  ],
  [
    'manual-device-qa-evidence',
    {
      label: 'manual device QA final proof',
      matches: matchesFinalScript('scripts/release/validate-manual-device-qa.mjs', [
        'artifacts/release/manual-device-qa/qaf035-manual-device-qa-20260603.json',
      ]),
    },
  ],
  [
    'design-parity-evidence',
    {
      label: 'design parity final proof',
      matches: matchesFinalScript('scripts/release/validate-design-parity-evidence.mjs', [
        'artifacts/release/design/qaf035-design-parity-20260603.json',
      ]),
    },
  ],
  [
    'performance-evidence',
    {
      label: 'performance evidence final proof',
      matches: matchesFinalScript('scripts/release/validate-performance-evidence.mjs', [
        'artifacts/release/performance/qaf035-performance-evidence-20260603.json',
      ]),
    },
  ],
  [
    'provider-owner-signoff',
    {
      label: 'provider owner final proof',
      matches: matchesFinalScript('scripts/release/validate-provider-owner-signoff.mjs', [
        'artifacts/release/provider/qaf035-provider-owner-signoff-20260603.json',
      ]),
    },
  ],
  [
    'beta-capacity-evidence',
    {
      label: 'beta capacity final proof',
      matches: matchesFinalScript('scripts/release/validate-beta-capacity-evidence.mjs', [
        'artifacts/release/capacity/qaf035-beta-capacity-20260602.json',
      ]),
    },
  ],
  [
    'runtime-media-policy',
    {
      label: 'runtime media policy final proof',
      matches: matchesFinalScript('scripts/release/validate-runtime-media-policy.mjs', [
        'artifacts/release/media-policy/qaf035-runtime-media-policy-20260602.json',
      ]),
    },
  ],
  [
    'observability-baseline',
    {
      label: 'observability baseline final proof',
      matches: matchesFinalScript('scripts/release/validate-observability-baseline.mjs', [
        'artifacts/release/observability/qaf035-observability-baseline-20260603.json',
      ]),
    },
  ],
  [
    'beta-ops-signoff',
    {
      label: 'beta ops final proof',
      matches: matchesFinalScript('scripts/release/validate-beta-ops-signoff.mjs', [
        'artifacts/release/ops/qaf035-beta-ops-signoff-20260603.json',
      ]),
    },
  ],
  [
    'security-privacy-baseline',
    {
      label: 'security/privacy final proof',
      matches: matchesFinalScript('scripts/release/validate-security-privacy-baseline.mjs', [
        'artifacts/release/security/qaf035-security-privacy-baseline-20260603.json',
      ]),
    },
  ],
]);
const readJson = (fileRef) => {
  const filePath = path.resolve(repoRoot, fileRef);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    fail(`Unable to read/parse JSON file: ${fileRef}`);
  }
};
const runLinkedValidator = (label, commandArgs) => {
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    const details = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    fail(`${label} failed linked validation: ${details}`);
  }
};
const artifactRefValidators = [
  {
    label: 'release readiness artifact',
    matches: (fileRef) => fileRef.endsWith('release-readiness-20260602.json'),
    commandArgs: (fileRef) => ['scripts/release/validate-release-readiness.mjs', fileRef],
  },
  {
    label: 'go/no-go artifact',
    matches: (fileRef) => fileRef.includes('/readiness/') && fileRef.includes('go-no-go'),
    commandArgs: (fileRef) => ['scripts/release/validate-go-no-go.mjs', fileRef],
  },
  {
    label: 'compatibility artifact',
    matches: (fileRef) => fileRef.includes('/compatibility/'),
    commandArgs: (fileRef) => ['scripts/release/compatibility-matrix-task.mjs', 'status', '--run', fileRef],
  },
  {
    label: 'manual device QA artifact',
    matches: (fileRef) => fileRef.includes('/manual-device-qa/'),
    commandArgs: (fileRef) => ['scripts/release/validate-manual-device-qa.mjs', fileRef],
  },
  {
    label: 'smoke/regression matrix artifact',
    matches: (fileRef) => fileRef.includes('/smoke/'),
    commandArgs: (fileRef) => ['scripts/release/validate-smoke-regression-matrix.mjs', fileRef],
  },
  {
    label: 'design parity artifact',
    matches: (fileRef) => fileRef.includes('/design/'),
    commandArgs: (fileRef) => ['scripts/release/validate-design-parity-evidence.mjs', fileRef],
  },
  {
    label: 'no-media scan artifact',
    matches: (fileRef) => fileRef.includes('/media-policy/') && fileRef.includes('no-media'),
    commandArgs: (fileRef) => ['scripts/release/validate-no-media-evidence-scan-artifact.mjs', fileRef],
  },
  {
    label: 'runtime media policy artifact',
    matches: (fileRef) => fileRef.includes('/media-policy/') && fileRef.includes('runtime-media-policy'),
    commandArgs: (fileRef) => ['scripts/release/validate-runtime-media-policy.mjs', fileRef],
  },
  {
    label: 'beta capacity artifact',
    matches: (fileRef) => fileRef.includes('/capacity/'),
    commandArgs: (fileRef) => ['scripts/release/validate-beta-capacity-evidence.mjs', fileRef],
  },
  {
    label: 'provider owner artifact',
    matches: (fileRef) => fileRef.includes('/provider/'),
    commandArgs: (fileRef) => ['scripts/release/validate-provider-owner-signoff.mjs', fileRef],
  },
  {
    label: 'beta ops artifact',
    matches: (fileRef) => fileRef.includes('/ops/'),
    commandArgs: (fileRef) => ['scripts/release/validate-beta-ops-signoff.mjs', fileRef],
  },
  {
    label: 'performance evidence artifact',
    matches: (fileRef) => fileRef.includes('/performance/'),
    commandArgs: (fileRef) => ['scripts/release/validate-performance-evidence.mjs', fileRef],
  },
  {
    label: 'observability baseline artifact',
    matches: (fileRef) => fileRef.includes('/observability/'),
    commandArgs: (fileRef) => ['scripts/release/validate-observability-baseline.mjs', fileRef],
  },
  {
    label: 'security/privacy baseline artifact',
    matches: (fileRef) => fileRef.includes('/security/'),
    commandArgs: (fileRef) => ['scripts/release/validate-security-privacy-baseline.mjs', fileRef],
  },
];
const findArtifactRefValidator = (fileRef) => artifactRefValidators.find((validator) => validator.matches(fileRef));

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

if (!isRepoRelativePath(plan.sourceReadinessArtifact)) {
  fail(`sourceReadinessArtifact must be repo-relative without parent traversal: ${plan.sourceReadinessArtifact}`);
}

if (!fs.existsSync(path.resolve(repoRoot, plan.sourceReadinessArtifact))) {
  fail(`sourceReadinessArtifact does not exist: ${plan.sourceReadinessArtifact}`);
}

runLinkedValidator('sourceReadinessArtifact', [
  'scripts/release/validate-release-readiness.mjs',
  plan.sourceReadinessArtifact,
]);

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

if (!isRepoRelativePath(plan.noMediaInvariant.trackedScanArtifact)) {
  fail(`noMediaInvariant.trackedScanArtifact must be repo-relative without parent traversal: ${plan.noMediaInvariant.trackedScanArtifact}`);
}

if (!fs.existsSync(path.resolve(repoRoot, plan.noMediaInvariant.trackedScanArtifact))) {
  fail(`noMediaInvariant.trackedScanArtifact does not exist: ${plan.noMediaInvariant.trackedScanArtifact}`);
}

runLinkedValidator('noMediaInvariant.trackedScanArtifact', [
  'scripts/release/validate-no-media-evidence-scan-artifact.mjs',
  plan.noMediaInvariant.trackedScanArtifact,
]);

if (!Array.isArray(plan.closureItems) || plan.closureItems.length === 0) {
  fail('closureItems must be a non-empty array.');
}

const openBlockersById = new Map(openBlockers.map((blocker) => [blocker.id, blocker]));
const seenClosureIds = new Set();
const closureByBlockerId = new Map();
const validatedArtifactRefs = new Set();

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
    if (!isRepoRelativePath(artifactRef)) {
      fail(`closure item ${item.id} artifactRef must be repo-relative without parent traversal: ${artifactRef}`);
    }
    if (!fs.existsSync(path.resolve(repoRoot, artifactRef))) {
      fail(`closure item ${item.id} artifactRef does not exist: ${artifactRef}`);
    }
    const linkedValidator = findArtifactRefValidator(artifactRef);
    if (linkedValidator && !validatedArtifactRefs.has(artifactRef)) {
      runLinkedValidator(`closure item ${item.id} artifactRef ${artifactRef}`, linkedValidator.commandArgs(artifactRef));
      validatedArtifactRefs.add(artifactRef);
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
    if (forbiddenMediaToolReferencePattern.test(command)) {
      fail(`closure item ${item.id} validationCommands must not reference ffmpeg/ffprobe.`);
    }
    for (const [label, pattern] of forbiddenMediaProcessingCommandPatterns) {
      if (pattern.test(command)) {
        fail(`closure item ${item.id} validationCommands must not reference forbidden media-processing term: ${label}.`);
      }
    }
  }

  const concreteFinalProofCommands = item.validationCommands.filter(isConcreteFinalProofCommand);
  if (item.status !== 'closed' && concreteFinalProofCommands.length === 0) {
    fail(`closure item ${item.id} validationCommands must include a concrete final proof command.`);
  }

  for (const gateId of item.gateIds) {
    const requiredFinalProof = requiredFinalProofByGate.get(gateId);
    if (!requiredFinalProof) {
      fail(`closure item ${item.id} gateId requires known final proof mapping: ${gateId}`);
    }
    if (!item.validationCommands.some(requiredFinalProof.matches)) {
      fail(`closure item ${item.id} validationCommands must include ${requiredFinalProof.label}.`);
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
