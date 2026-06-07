import { runMobileLayoutSmoke } from './mobileLayoutSmoke.mjs';

const report = await runMobileLayoutSmoke();

console.log(
  `Mobile layout smoke ${report.status}: output/playwright/mobile-layout-smoke/REPORT.md`
);
process.exitCode = report.status === 'pass' ? 0 : 1;
