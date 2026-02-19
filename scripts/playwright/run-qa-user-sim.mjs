import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

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

  return {
    title: scenarioName,
    status: testResult.status,
    timeline,
    blockers,
    attachments: testResult.attachments.filter((att) => Boolean(att.path)),
    error: testResult.error,
    testFile: testResult.testFile,
  };
});

const allTimelineEntries = scenarios.flatMap((scenario) => scenario.timeline);
const allBlockers = scenarios.flatMap((scenario) => scenario.blockers);
const blockedSteps = allTimelineEntries.filter((item) => item.status === 'blocked').length;
const scenarioStatus = (() => {
  if (scenarios.length === 0) {
    return 'unknown';
  }

  const hasFailedScenario = scenarios.some((scenario) => scenario.status !== 'passed');
  if (hasFailedScenario) {
    return scenarios.find((scenario) => scenario.status !== 'passed')?.status ?? 'failed';
  }

  if (blockedSteps > 0 || allBlockers.length > 0) {
    return 'passed-with-blockers';
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
  '',
  ...scenarioSections,
  '## Global Blockers',
  ...(allBlockers.length > 0
    ? allBlockers.map((entry) => `- [BLOCKER] ${entry}`)
    : ['- [INFO] No blockers recorded in this run.']),
  '',
  '## Artifacts',
  ...attachmentLines,
  '',
].join('\n');

writeFileSync(reportMdPath, report, 'utf-8');

const taskCandidates = allBlockers.length > 0
  ? Array.from(new Set(allBlockers)).map((entry) => `- [ ] ${entry}`)
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
