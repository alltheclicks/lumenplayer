#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const allowedCaseStatus = new Set(['pending', 'pass', 'fail']);
const allowedSignoffStatus = new Set(['pass', 'fail']);
const allowedMatchModes = new Set(['any', 'all']);

const fail = (message) => {
  console.error(`[compat-matrix] ERROR: ${message}`);
  process.exit(2);
};

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const sortedStrings = (values) => values.map(String).sort((a, b) => a.localeCompare(b));
const sameStringSet = (left, right) => {
  const sortedLeft = sortedStrings(left);
  const sortedRight = sortedStrings(right);
  return sortedLeft.length === sortedRight.length
    && sortedLeft.every((value, index) => value === sortedRight[index]);
};
const resultMatchesTargetTags = (result, target) => {
  if (!Array.isArray(result.tags)) {
    return false;
  }

  const resultTags = new Set(result.tags);
  if (target.matchMode === 'all') {
    return target.requiredTags.every((tag) => resultTags.has(tag));
  }

  return target.requiredTags.some((tag) => resultTags.has(tag));
};

const nowIso = () => new Date().toISOString();

const parseArgs = (args) => {
  const parsed = { _: [] };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith('--')) {
      parsed._.push(token);
      continue;
    }

    const key = token.slice(2);
    const value = args[i + 1];
    if (typeof value !== 'string' || value.startsWith('--')) {
      parsed[key] = true;
      continue;
    }

    parsed[key] = value;
    i += 1;
  }

  return parsed;
};

const readJson = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`Unable to read JSON: ${filePath}`);
  }
};

const writeJson = (filePath, data) => {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
};

const summarizeResults = (results) => {
  const counts = { pending: 0, pass: 0, fail: 0 };
  for (const result of results) {
    if (counts[result.status] === undefined) {
      fail(`run file contains invalid case status for ${result.caseId ?? 'unknown'}: ${result.status}`);
    }

    counts[result.status] += 1;
  }

  return counts;
};

const usage = () => {
  console.log('Usage: node scripts/release/compatibility-matrix-task.mjs <command> [options]');
  console.log('Commands:');
  console.log('  init --matrix <path> [--targets <path>] [--out <path>] [--operator <name>] [--run-id <id>]');
  console.log('  set --run <path> --case <id> --status <pending|pass|fail> [--target <id>] [--evidence <text>] [--notes <text>] [--executor <name>]');
  console.log('  status --run <path> [--require-final] [--require-targets <path>]');
  console.log('  finalize --run <path> --signoff <pass|fail> --approved-by <name> [--notes <text>]');
};

const validateMatrix = (matrix) => {
  if (!Array.isArray(matrix.cases) || matrix.cases.length === 0) {
    fail('matrix.cases must be a non-empty array');
  }

  const seenCaseIds = new Set();
  for (const testCase of matrix.cases) {
    if (typeof testCase.id !== 'string' || testCase.id.trim() === '') {
      fail('matrix case is missing a valid id');
    }

    if (typeof testCase.suite !== 'string' || testCase.suite.trim() === '') {
      fail(`matrix case ${testCase.id} is missing suite`);
    }

    if (typeof testCase.title !== 'string' || testCase.title.trim() === '') {
      fail(`matrix case ${testCase.id} is missing title`);
    }

    if (typeof testCase.platform !== 'string' || testCase.platform.trim() === '') {
      fail(`matrix case ${testCase.id} is missing platform`);
    }

    if (typeof testCase.device !== 'string' || testCase.device.trim() === '') {
      fail(`matrix case ${testCase.id} is missing device`);
    }

    if (typeof testCase.browser !== 'string' || testCase.browser.trim() === '') {
      fail(`matrix case ${testCase.id} is missing browser`);
    }

    if (!Array.isArray(testCase.tags) || testCase.tags.length === 0) {
      fail(`matrix case ${testCase.id} must have tags`);
    }

    if (seenCaseIds.has(testCase.id)) {
      fail(`matrix contains duplicate case id: ${testCase.id}`);
    }

    seenCaseIds.add(testCase.id);
  }
};

const validateTargets = (targetsDoc) => {
  if (!Array.isArray(targetsDoc.targets) || targetsDoc.targets.length === 0) {
    fail('targets file must define a non-empty targets array');
  }

  const seenTargetIds = new Set();
  const targets = [];

  for (const target of targetsDoc.targets) {
    if (!target || typeof target !== 'object') {
      fail('each target must be an object');
    }

    if (typeof target.id !== 'string' || target.id.trim() === '') {
      fail('each target must have a non-empty id');
    }

    if (seenTargetIds.has(target.id)) {
      fail(`targets contain duplicate id: ${target.id}`);
    }

    if (typeof target.name !== 'string' || target.name.trim() === '') {
      fail(`target ${target.id} must have a non-empty name`);
    }

    if (typeof target.platform !== 'string' || target.platform.trim() === '') {
      fail(`target ${target.id} must have a non-empty platform`);
    }

    if (typeof target.device !== 'string' || target.device.trim() === '') {
      fail(`target ${target.id} must have a non-empty device`);
    }

    if (typeof target.browser !== 'string' || target.browser.trim() === '') {
      fail(`target ${target.id} must have a non-empty browser`);
    }

    if (!Array.isArray(target.requiredTags) || target.requiredTags.length === 0) {
      fail(`target ${target.id} must include at least one required tag`);
    }

    const matchMode = typeof target.matchMode === 'string' ? target.matchMode : 'any';
    if (!allowedMatchModes.has(matchMode)) {
      fail(`target ${target.id} must use matchMode \"any\" or \"all\"`);
    }

    for (const tag of target.requiredTags) {
      if (typeof tag !== 'string' || tag.trim() === '') {
        fail(`target ${target.id} contains an invalid requiredTag value`);
      }
    }

    seenTargetIds.add(target.id);
    targets.push({
      ...target,
      matchMode,
    });
  }

  return targets;
};

const buildResults = (matrixCases, targets) => {
  if (!targets || targets.length === 0) {
    return matrixCases.map((testCase) => ({
      caseId: testCase.id,
      suite: testCase.suite,
      title: testCase.title,
      platform: testCase.platform,
      device: testCase.device,
      browser: testCase.browser,
      casePlatform: testCase.platform,
      caseDevice: testCase.device,
      caseBrowser: testCase.browser,
      targetId: '',
      targetName: '',
      targetPlatform: '',
      targetDevice: '',
      targetBrowser: '',
      releaseBlocker: Boolean(testCase.releaseBlocker),
      tags: Array.isArray(testCase.tags) ? testCase.tags : [],
      status: 'pending',
      evidence: '',
      notes: '',
      executedAt: '',
      executor: '',
    }));
  }

  const results = [];

  for (const target of targets) {
    const requiredTagSet = new Set(target.requiredTags);
    const matchedCases = [];
    for (const testCase of matrixCases) {
      if (!Array.isArray(testCase.tags)) {
        continue;
      }

      let matchesTarget = false;
      if (target.matchMode === 'all') {
        const caseTagSet = new Set(testCase.tags);
        matchesTarget = target.requiredTags.every((tag) => caseTagSet.has(tag));
      } else {
        for (const tag of testCase.tags) {
          if (requiredTagSet.has(tag)) {
            matchesTarget = true;
            break;
          }
        }
      }

      if (matchesTarget) {
        matchedCases.push(testCase);
      }
    }

    if (matchedCases.length === 0) {
      fail(`target ${target.id} does not match any matrix case by requiredTags`);
    }

    for (const testCase of matchedCases) {
      results.push({
        caseId: testCase.id,
        suite: testCase.suite,
        title: testCase.title,
        platform: target.platform,
        device: target.device,
        browser: target.browser,
        casePlatform: testCase.platform,
        caseDevice: testCase.device,
        caseBrowser: testCase.browser,
        targetId: target.id,
        targetName: target.name,
        targetPlatform: target.platform,
        targetDevice: target.device,
        targetBrowser: target.browser,
        releaseBlocker: Boolean(testCase.releaseBlocker),
        tags: Array.isArray(testCase.tags) ? testCase.tags : [],
        status: 'pending',
        evidence: '',
        notes: '',
        executedAt: '',
        executor: '',
      });
    }
  }

  if (results.length === 0) {
    fail('no compatibility execution results were generated from matrix/targets');
  }

  return results;
};

const initCommand = (args) => {
  if (!args.matrix) {
    fail('init requires --matrix <path>');
  }

  const matrixPath = path.resolve(process.cwd(), String(args.matrix));
  const matrix = readJson(matrixPath);
  validateMatrix(matrix);

  let targets = [];
  let targetsPath = '';

  if (args.targets) {
    targetsPath = path.resolve(process.cwd(), String(args.targets));
    const targetsDoc = readJson(targetsPath);
    targets = validateTargets(targetsDoc);
  }

  const runId = args['run-id'] ? String(args['run-id']) : `compat-${Date.now()}`;
  const outPath = args.out
    ? path.resolve(process.cwd(), String(args.out))
    : path.resolve(process.cwd(), `artifacts/release/compatibility/${runId}.json`);

  const results = buildResults(matrix.cases, targets);

  const run = {
    runId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    operator: args.operator ? String(args.operator) : '',
    matrixSource: path.relative(process.cwd(), matrixPath),
    targetsSource: targetsPath ? path.relative(process.cwd(), targetsPath) : '',
    release: matrix.release ?? 'V1',
    matrixTemplateVersion: matrix.templateVersion ?? 1,
    status: 'in-progress',
    targets: targets.map((target) => ({
      id: target.id,
      name: target.name,
      platform: target.platform,
      device: target.device,
      browser: target.browser,
      matchMode: target.matchMode,
      requiredTags: target.requiredTags,
    })),
    results,
    signoff: {
      status: 'pending',
      approvedBy: '',
      approvedAt: '',
      notes: '',
    },
  };

  writeJson(outPath, run);
  console.log(`[compat-matrix] created run: ${outPath}`);
  console.log(`[compat-matrix] cases: ${run.results.length}`);
  if (targets.length > 0) {
    console.log(`[compat-matrix] targets: ${targets.length}`);
  }
};

const setCommand = (args) => {
  if (!args.run || !args.case || !args.status) {
    fail('set requires --run, --case, and --status');
  }

  if (!allowedCaseStatus.has(String(args.status))) {
    fail('set --status must be one of pending/pass/fail');
  }

  const runPath = path.resolve(process.cwd(), String(args.run));
  const run = readJson(runPath);

  if (!Array.isArray(run.results)) {
    fail('run file is invalid: results array is missing');
  }

  const caseId = String(args.case);
  const targetId = args.target ? String(args.target) : '';
  const matches = run.results.filter((result) => (
    result.caseId === caseId
    && (targetId === '' || result.targetId === targetId)
  ));

  if (matches.length === 0) {
    fail(`case not found in run: ${caseId}${targetId ? ` (target: ${targetId})` : ''}`);
  }

  if (matches.length > 1 && targetId === '') {
    fail(`case ${caseId} matches multiple targets; provide --target <id>`);
  }

  if (matches.length > 1) {
    fail(`case ${caseId} still ambiguous for target ${targetId}`);
  }

  const target = matches[0];
  target.status = String(args.status);
  if (target.status === 'pending') {
    target.executedAt = '';
  } else {
    target.executedAt = nowIso();
  }

  if (args.evidence) {
    target.evidence = String(args.evidence);
  }

  if (args.notes) {
    target.notes = String(args.notes);
  }

  if (args.executor) {
    target.executor = String(args.executor);
  }

  run.updatedAt = nowIso();
  const counts = summarizeResults(run.results);
  if (counts.pending === 0) {
    run.status = 'ready-for-signoff';
  } else {
    run.status = 'in-progress';
  }

  writeJson(runPath, run);
  const targetLabel = target.targetId ? ` on ${target.targetId}` : '';
  console.log(`[compat-matrix] updated case ${target.caseId}${targetLabel} -> ${target.status}`);
};

const statusCommand = (args) => {
  if (!args.run) {
    fail('status requires --run <path>');
  }

  const requireFinal = args['require-final'] === true;
  let requiredTargets = [];
  if (args['require-targets']) {
    const targetsPath = path.resolve(process.cwd(), String(args['require-targets']));
    const targetsDoc = readJson(targetsPath);
    requiredTargets = validateTargets(targetsDoc);
  }

  const runPath = path.resolve(process.cwd(), String(args.run));
  const run = readJson(runPath);
  if (!Array.isArray(run.results)) {
    fail('run file is invalid: results array is missing');
  }

  const counts = summarizeResults(run.results);
  const blockerFail = run.results.filter((result) => result.releaseBlocker && result.status === 'fail').length;
  const missingEvidence = run.results.filter((result) => !isNonEmptyString(result.evidence));
  const runTargetIds = new Set((Array.isArray(run.targets) ? run.targets : [])
    .map((target) => target.id)
    .filter(isNonEmptyString));
  const runTargetsById = new Map((Array.isArray(run.targets) ? run.targets : [])
    .filter((target) => isNonEmptyString(target.id))
    .map((target) => [target.id, target]));
  const resultTargetIds = new Set(run.results
    .map((result) => result.targetId)
    .filter(isNonEmptyString));

  if (requireFinal) {
    if (run.status !== 'completed') {
      fail('status --require-final requires run.status to be completed.');
    }

    if (counts.pending > 0) {
      fail(`status --require-final requires zero pending cases; found ${counts.pending}.`);
    }

    if (blockerFail > 0) {
      fail(`status --require-final forbids release-blocker failures; found ${blockerFail}.`);
    }

    if (missingEvidence.length > 0) {
      const firstMissing = missingEvidence[0];
      const targetLabel = firstMissing.targetId ? ` on ${firstMissing.targetId}` : '';
      fail(`status --require-final requires evidence for every case; first missing is ${firstMissing.caseId}${targetLabel}.`);
    }

    if (!run.signoff || run.signoff.status !== 'pass') {
      fail('status --require-final requires signoff.status pass.');
    }

    if (!isNonEmptyString(run.signoff.approvedBy)) {
      fail('status --require-final requires signoff.approvedBy.');
    }

    if (!isNonEmptyString(run.signoff.approvedAt)) {
      fail('status --require-final requires signoff.approvedAt.');
    }

    for (const target of requiredTargets) {
      if (!runTargetIds.has(target.id)) {
        fail(`status --require-final requires target ${target.id}.`);
      }

      if (!resultTargetIds.has(target.id)) {
        fail(`status --require-final requires at least one result for target ${target.id}.`);
      }

      const runTarget = runTargetsById.get(target.id);
      for (const field of ['name', 'platform', 'device', 'browser', 'matchMode']) {
        if (runTarget[field] !== target[field]) {
          fail(`status --require-final requires target ${target.id} ${field} to match required target profile.`);
        }
      }

      if (!Array.isArray(runTarget.requiredTags) || !sameStringSet(runTarget.requiredTags, target.requiredTags)) {
        fail(`status --require-final requires target ${target.id} requiredTags to match required target profile.`);
      }

      const targetResults = run.results.filter((result) => result.targetId === target.id);
      for (const result of targetResults) {
        if (!resultMatchesTargetTags(result, target)) {
          fail(`status --require-final requires result ${result.caseId} on ${target.id} tags to match required target profile.`);
        }

        for (const [field, expected] of [
          ['platform', target.platform],
          ['device', target.device],
          ['browser', target.browser],
          ['targetPlatform', target.platform],
          ['targetDevice', target.device],
          ['targetBrowser', target.browser],
        ]) {
          if (result[field] !== expected) {
            fail(`status --require-final requires result ${result.caseId} on ${target.id} ${field} to match required target profile.`);
          }
        }
      }
    }
  }

  console.log(`[compat-matrix] runId: ${run.runId}`);
  console.log(`[compat-matrix] status: ${run.status}`);
  console.log(`[compat-matrix] counts: pending=${counts.pending}, pass=${counts.pass}, fail=${counts.fail}`);
  console.log(`[compat-matrix] release-blocker failures: ${blockerFail}`);
  console.log(`[compat-matrix] signoff: ${run.signoff?.status ?? 'pending'}`);
  console.log(`[compat-matrix] require-final: ${requireFinal ? 'yes' : 'no'}`);

  if (Array.isArray(run.targets) && run.targets.length > 0) {
    for (const target of run.targets) {
      const targetResults = run.results.filter((result) => result.targetId === target.id);
      const targetCounts = summarizeResults(targetResults);
      console.log(`[compat-matrix] target ${target.id}: pending=${targetCounts.pending}, pass=${targetCounts.pass}, fail=${targetCounts.fail}`);
    }
  }
};

const finalizeCommand = (args) => {
  if (!args.run || !args.signoff || !args['approved-by']) {
    fail('finalize requires --run, --signoff, and --approved-by');
  }

  const signoffStatus = String(args.signoff);
  if (!allowedSignoffStatus.has(signoffStatus)) {
    fail('finalize --signoff must be pass or fail');
  }

  const runPath = path.resolve(process.cwd(), String(args.run));
  const run = readJson(runPath);

  if (!Array.isArray(run.results) || run.results.length === 0) {
    fail('run file is invalid: results array is missing/empty');
  }

  if (run.status === 'completed') {
    fail('run is already finalized');
  }

  for (const result of run.results) {
    if (!allowedCaseStatus.has(result.status)) {
      fail(`run file contains invalid case status for ${result.caseId}: ${result.status}`);
    }
  }

  const counts = summarizeResults(run.results);
  const blockerFailures = run.results.filter((result) => result.releaseBlocker && result.status === 'fail');

  if (counts.pending > 0) {
    fail('cannot finalize while there are pending cases');
  }

  const missingEvidence = run.results.filter((result) => (
    typeof result.evidence !== 'string' || result.evidence.trim() === ''
  ));
  if (missingEvidence.length > 0) {
    const firstMissing = missingEvidence[0];
    const targetLabel = firstMissing.targetId ? ` on ${firstMissing.targetId}` : '';
    fail(`cannot finalize: ${missingEvidence.length} case(s) missing evidence; first is ${firstMissing.caseId}${targetLabel}`);
  }

  if (signoffStatus === 'pass' && blockerFailures.length > 0) {
    fail(`cannot pass signoff: ${blockerFailures.length} release-blocker case(s) failed`);
  }

  run.status = 'completed';
  run.updatedAt = nowIso();
  run.signoff = {
    status: signoffStatus,
    approvedBy: String(args['approved-by']),
    approvedAt: nowIso(),
    notes: args.notes ? String(args.notes) : '',
  };

  writeJson(runPath, run);
  console.log(`[compat-matrix] finalized run ${run.runId} with signoff=${run.signoff.status}`);
};

const main = () => {
  const [, , command, ...rest] = process.argv;

  if (!command || command === '--help' || command === '-h') {
    usage();
    process.exit(0);
  }

  const args = parseArgs(rest);

  switch (command) {
    case 'init':
      initCommand(args);
      break;
    case 'set':
      setCommand(args);
      break;
    case 'status':
      statusCommand(args);
      break;
    case 'finalize':
      finalizeCommand(args);
      break;
    default:
      usage();
      fail(`Unknown command: ${command}`);
  }
};

main();
