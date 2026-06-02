import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildXtreamActionSuccessCounts,
  classifyXtreamFailureSeverity,
  formatActionBreakdownLines,
  formatSuccessBreakdownLines,
  summarizeXtreamActionFailures,
  summarizeXtreamActionSuccesses,
} from './qaUserSimReport.mjs';

const root = process.cwd();
const outDir = resolve(root, 'output/playwright/qa-user-sim');
const resultJsonPath = resolve(outDir, 'results.json');
const reportMdPath = resolve(outDir, 'QA-REPORT.md');
const tasksMdPath = resolve(outDir, 'TASK-CANDIDATES.md');

mkdirSync(outDir, { recursive: true });

const run = spawnSync(
  'pnpm',
  [
    'exec',
    'playwright',
    'test',
    '-c',
    'playwright.config.ts',
    'e2e/qa-series-live-context.spec.ts',
    'e2e/qa-live-autoplay.spec.ts',
    '--reporter=json',
  ],
  {
    cwd: root,
    encoding: 'utf-8',
    env: process.env,
  }
);

writeFileSync(resultJsonPath, run.stdout || '{}', 'utf-8');

let parsed = { suites: [] };
try {
  parsed = JSON.parse(run.stdout || '{}');
} catch {
  parsed = { suites: [] };
}

const tests = [];
const walk = (suites) => {
  for (const suite of suites || []) {
    walk(suite.suites || []);
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        const result = (test.results || []).at(-1);
        tests.push({
          title: test.title || spec.title || 'Unnamed',
          status: result?.status || 'unknown',
          attachments: result?.attachments || [],
          error: result?.error?.message || '',
          testFile: spec.file || '',
        });
      }
    }
  }
};
walk(parsed.suites);

const scenarios = tests.map((testResult) => {
  let scenarioName = testResult.title;
  let timeline = [];
  let blockers = [];
  let networkFailures = [];
  let networkSuccesses = [];

  const timelineAttachment = testResult.attachments.find((att) => att.name === 'qa-timeline');
  if (timelineAttachment?.path && existsSync(timelineAttachment.path)) {
    try {
      const content = JSON.parse(readFileSync(timelineAttachment.path, 'utf-8'));
      scenarioName = content.scenario || scenarioName;
      timeline = content.timeline || [];
      blockers = content.blockers || [];
    } catch {
      timeline = [];
      blockers = [];
    }
  }

  const networkAttachment = testResult.attachments.find((att) => att.name === 'qa-network');
  if (networkAttachment?.path && existsSync(networkAttachment.path)) {
    try {
      const content = JSON.parse(readFileSync(networkAttachment.path, 'utf-8'));
      const failures = Array.isArray(content.failures) ? content.failures : [];
      networkFailures = failures.filter((failure) => (
        typeof failure === 'object' &&
        failure !== null &&
        typeof failure.action === 'string'
      ));
      const successes = Array.isArray(content.successes) ? content.successes : [];
      networkSuccesses = successes.filter((success) => (
        typeof success === 'object' &&
        success !== null &&
        typeof success.action === 'string'
      ));
    } catch {
      networkFailures = [];
      networkSuccesses = [];
    }
  }

  return {
    title: scenarioName,
    status: testResult.status,
    timeline,
    blockers,
    networkFailures,
    networkSuccesses,
    attachments: testResult.attachments.filter((att) => Boolean(att.path)),
    error: testResult.error,
    testFile: testResult.testFile,
  };
});

const allTimelineEntries = scenarios.flatMap((scenario) => scenario.timeline);
const allBlockers = scenarios.flatMap((scenario) => scenario.blockers);
const allNetworkFailures = scenarios.flatMap((scenario) => scenario.networkFailures);
const allNetworkSuccesses = scenarios.flatMap((scenario) => scenario.networkSuccesses);
const actionSuccessCounts = buildXtreamActionSuccessCounts(allNetworkSuccesses);
const criticalNetworkFailures = allNetworkFailures.filter(
  (failure) => classifyXtreamFailureSeverity(failure, actionSuccessCounts) === 'critical'
);
const nonCriticalNetworkFailures = allNetworkFailures.filter(
  (failure) => classifyXtreamFailureSeverity(failure, actionSuccessCounts) === 'non-critical'
);
const topLevelErrors = Array.isArray(parsed.errors)
  ? parsed.errors
    .map((error) => error?.message || error?.stack || '')
    .filter((message) => typeof message === 'string' && message.trim().length > 0)
  : [];
const xtreamActionFailureBreakdown = summarizeXtreamActionFailures(allNetworkFailures);
const xtreamActionSuccessBreakdown = summarizeXtreamActionSuccesses(allNetworkSuccesses);
const criticalActionBreakdown = summarizeXtreamActionFailures(criticalNetworkFailures);
const nonCriticalActionBreakdown = summarizeXtreamActionFailures(nonCriticalNetworkFailures);
const blockedSteps = allTimelineEntries.filter((item) => item.status === 'blocked').length;
const scenarioStatus = (() => {
  if (topLevelErrors.length > 0) {
    return 'failed';
  }

  if (scenarios.length === 0) {
    return 'unknown';
  }

  const hasFailedScenario = scenarios.some((scenario) => scenario.status !== 'passed');
  if (hasFailedScenario) {
    return scenarios.find((scenario) => scenario.status !== 'passed')?.status ?? 'failed';
  }

  if (blockedSteps > 0 || allBlockers.length > 0 || criticalNetworkFailures.length > 0) {
    return 'passed-with-blockers';
  }

  if (nonCriticalNetworkFailures.length > 0) {
    return 'passed-with-warnings';
  }

  return 'passed';
})();

const scenarioSections = scenarios.flatMap((scenario) => {
  const stepLines = scenario.timeline.map((item) => {
    const marker = item.status === 'pass' ? '[PASS]' : item.status === 'blocked' ? '[BLOCKED]' : '[INFO]';
    return `- ${marker} ${item.step} (${item.code}) | ${item.note} | \`${item.url}\``;
  });

  const blockerLines = scenario.blockers.length > 0
    ? scenario.blockers.map((entry) => `- [BLOCKER] ${entry}`)
    : ['- [INFO] No blockers recorded in this scenario.'];

  return [
    `## Scenario: ${scenario.title}`,
    ...stepLines,
    '',
    `- Scenario test status: \`${scenario.status}\``,
    `- Scenario source: \`${scenario.testFile || 'n/a'}\``,
    '',
    '### Scenario Blockers',
    ...blockerLines,
    '',
  ];
});

const allAttachments = scenarios
  .flatMap((scenario) => scenario.attachments)
  .map((attachment) => `- ${attachment.name}: \`${attachment.path}\``);

const attachmentLines = allAttachments.length > 0
  ? allAttachments
  : ['- [INFO] No attachment metadata found.'];

const actionBreakdownLines = formatActionBreakdownLines(
  xtreamActionFailureBreakdown,
  'No Xtream API failures captured by action in this run.'
);
const criticalActionBreakdownLines = formatActionBreakdownLines(
  criticalActionBreakdown,
  'No critical Xtream API failures in this run.'
);
const nonCriticalActionBreakdownLines = formatActionBreakdownLines(
  nonCriticalActionBreakdown,
  'No non-critical Xtream API failures in this run.'
);
const actionSuccessBreakdownLines = formatSuccessBreakdownLines(
  xtreamActionSuccessBreakdown,
  'No successful Xtream API responses captured by action in this run.'
);

const globalBlockers = [
  ...allBlockers,
  ...topLevelErrors.map((message) => `PLAYWRIGHT_SETUP_ERROR: ${message}`),
  ...Array.from(criticalActionBreakdown.entries()).map(
    ([action, summary]) => `NETWORK_CRITICAL ${action}: total=${summary.total}`
  ),
];

const report = [
  '# QA User Simulation Report',
  '',
  `- Timestamp: \`${new Date().toISOString()}\``,
  `- Base URL: \`${process.env.E2E_BASE_URL ?? 'http://localhost:8080'}\``,
  `- Username env set: \`${process.env.E2E_XUI_USERNAME ? 'yes' : 'no'}\``,
  `- Password env set: \`${process.env.E2E_XUI_PASSWORD ? 'yes' : 'no'}\``,
  `- Scenario status: \`${scenarioStatus}\``,
  `- Scenarios executed: \`${scenarios.length}\``,
  `- Timeline totals: pass=${allTimelineEntries.filter((item) => item.status === 'pass').length}, blocked=${blockedSteps}, info=${allTimelineEntries.filter((item) => item.status === 'info').length}`,
  `- Xtream API failures captured: \`${allNetworkFailures.length}\``,
  `- Xtream API successes captured: \`${allNetworkSuccesses.length}\``,
  `- Network severity totals: critical=${criticalNetworkFailures.length}, non-critical=${nonCriticalNetworkFailures.length}`,
  '',
  ...scenarioSections,
  '## Network Failure Severity',
  '### Critical',
  ...criticalActionBreakdownLines,
  '',
  '### Non-critical',
  ...nonCriticalActionBreakdownLines,
  '',
  '## Xtream API Failure Breakdown (by action)',
  ...actionBreakdownLines,
  '',
  '## Xtream API Success Breakdown (by action)',
  ...actionSuccessBreakdownLines,
  '',
  '## Global Blockers',
  ...(globalBlockers.length > 0
    ? Array.from(new Set(globalBlockers)).map((entry) => `- [BLOCKER] ${entry}`)
    : ['- [INFO] No blockers recorded in this run.']),
  '',
  '## Artifacts',
  ...attachmentLines,
  '',
].join('\n');

writeFileSync(reportMdPath, report, 'utf-8');

const taskCandidates = globalBlockers.length > 0
  ? Array.from(new Set(globalBlockers)).map((entry) => `- [ ] ${entry}`)
  : ['- [ ] No blockers detected in this run.'];

const tasksReport = [
  '# QA Task Candidates',
  '',
  `- Timestamp: \`${new Date().toISOString()}\``,
  `- Source report: \`${reportMdPath}\``,
  '',
  '## Candidate Tasks',
  ...taskCandidates,
  '',
].join('\n');

writeFileSync(tasksMdPath, tasksReport, 'utf-8');

if (run.stderr) {
  process.stderr.write(run.stderr);
}

if (run.status !== 0) {
  console.error(`[qa-user-sim] Report generated at ${reportMdPath}`);
  process.exit(run.status || 1);
}

console.log(`[qa-user-sim] Report generated at ${reportMdPath}`);
