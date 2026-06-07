import { runDesignParityCapture } from './designParityCapture.mjs';

const report = await runDesignParityCapture();

console.log(`Design parity captures ${report.status}: output/playwright/lp-0373/CAPTURE-REPORT.md`);
process.exitCode = report.status === 'pass' ? 0 : 1;
