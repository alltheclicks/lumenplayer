import { runStagingCapacitySmoke } from './stagingCapacitySmoke.mjs';

const report = await runStagingCapacitySmoke();

console.log(`Staging capacity smoke ${report.status}: output/perf/staging-capacity-smoke/REPORT.md`);
process.exitCode = report.status === 'pass' ? 0 : 1;
