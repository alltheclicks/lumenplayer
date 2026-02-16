#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const allowedCaseStatus = new Set(['pending', 'pass', 'fail']);
const allowedSignoffStatus = new Set(['pass', 'fail']);

const fail = (message) => {
  console.error(`[compat-matrix] ERROR: ${message}`);
  process.exit(2);
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
    if (!value || value.startsWith('--')) {
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

const summarize = (run) => {
  const counts = { pending: 0, pass: 0, fail: 0 };
  for (const result of run.results) {
    if (counts[result.status] !== undefined) {
      counts[result.status] += 1;
    }
  }

  return counts;
};

const usage = () => {
  console.log('Usage: node scripts/release/compatibility-matrix-task.mjs <command> [options]');
  console.log('Commands:');
  console.log('  init --matrix <path> [--out <path>] [--operator <name>] [--run-id <id>]');
  console.log('  set --run <path> --case <id> --status <pending|pass|fail> [--evidence <text>] [--notes <text>] [--executor <name>]');
  console.log('  status --run <path>');
  console.log('  finalize --run <path> --signoff <pass|fail> --approved-by <name> [--notes <text>]');
};

const initCommand = (args) => {
  if (!args.matrix) {
    fail('init requires --matrix <path>');
  }

  const matrixPath = path.resolve(process.cwd(), String(args.matrix));
  const matrix = readJson(matrixPath);

  if (!Array.isArray(matrix.cases) || matrix.cases.length === 0) {
    fail('matrix.cases must be a non-empty array');
  }

  const seenCaseIds = new Set();
  for (const testCase of matrix.cases) {
    if (typeof testCase.id !== 'string' || testCase.id.trim() === '') {
      fail('matrix case is missing a valid id');
    }

    if (seenCaseIds.has(testCase.id)) {
      fail(`matrix contains duplicate case id: ${testCase.id}`);
    }

    seenCaseIds.add(testCase.id);
  }

  const runId = args['run-id'] ? String(args['run-id']) : `compat-${Date.now()}`;
  const outPath = args.out
    ? path.resolve(process.cwd(), String(args.out))
    : path.resolve(process.cwd(), `artifacts/release/compatibility/${runId}.json`);

  const run = {
    runId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    operator: args.operator ? String(args.operator) : '',
    matrixSource: path.relative(process.cwd(), matrixPath),
    release: matrix.release ?? 'V1',
    matrixTemplateVersion: matrix.templateVersion ?? 1,
    status: 'in-progress',
    results: matrix.cases.map((testCase) => ({
      caseId: testCase.id,
      suite: testCase.suite,
      title: testCase.title,
      platform: testCase.platform,
      device: testCase.device,
      browser: testCase.browser,
      releaseBlocker: Boolean(testCase.releaseBlocker),
      tags: Array.isArray(testCase.tags) ? testCase.tags : [],
      status: 'pending',
      evidence: '',
      notes: '',
      executedAt: '',
      executor: '',
    })),
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

  const target = run.results.find((result) => result.caseId === String(args.case));
  if (!target) {
    fail(`case not found in run: ${String(args.case)}`);
  }

  target.status = String(args.status);
  target.executedAt = nowIso();

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
  const counts = summarize(run);
  if (counts.pending === 0) {
    run.status = 'ready-for-signoff';
  } else {
    run.status = 'in-progress';
  }

  writeJson(runPath, run);
  console.log(`[compat-matrix] updated case ${target.caseId} -> ${target.status}`);
};

const statusCommand = (args) => {
  if (!args.run) {
    fail('status requires --run <path>');
  }

  const runPath = path.resolve(process.cwd(), String(args.run));
  const run = readJson(runPath);
  const counts = summarize(run);
  const blockerFail = run.results.filter((result) => result.releaseBlocker && result.status === 'fail').length;

  console.log(`[compat-matrix] runId: ${run.runId}`);
  console.log(`[compat-matrix] status: ${run.status}`);
  console.log(`[compat-matrix] counts: pending=${counts.pending}, pass=${counts.pass}, fail=${counts.fail}`);
  console.log(`[compat-matrix] release-blocker failures: ${blockerFail}`);
  console.log(`[compat-matrix] signoff: ${run.signoff?.status ?? 'pending'}`);
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

  for (const result of run.results) {
    if (!allowedCaseStatus.has(result.status)) {
      fail(`run file contains invalid case status for ${result.caseId}: ${result.status}`);
    }
  }

  const counts = summarize(run);
  const blockerFailures = run.results.filter((result) => result.releaseBlocker && result.status === 'fail');

  if (counts.pending > 0) {
    fail('cannot finalize while there are pending cases');
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
