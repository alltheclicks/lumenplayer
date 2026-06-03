#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const allowedMetricStatus = new Set(['pending', 'pass', 'fail']);
const allowedSignoffStatus = new Set(['pending', 'pass', 'fail']);

const usage = () => {
  console.error('Usage: node scripts/release/validate-performance-evidence.mjs <file> [--require-final]');
};

const [, , fileArg, ...flags] = process.argv;
if (!fileArg) {
  usage();
  process.exit(1);
}

const requireFinal = flags.includes('--require-final');
const filePath = path.resolve(process.cwd(), fileArg);

const fail = (message) => {
  console.error(`[perf-evidence] ERROR: ${message}`);
  process.exit(2);
};

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

let artifact;
try {
  artifact = JSON.parse(fs.readFileSync(filePath, 'utf8'));
} catch {
  fail(`Unable to read/parse JSON file: ${filePath}`);
}

if (!artifact.dataset || typeof artifact.dataset !== 'object') {
  fail('dataset object is required.');
}

if (typeof artifact.dataset.channelCount !== 'number' || artifact.dataset.channelCount <= 0) {
  fail('dataset.channelCount must be a positive number.');
}

if (typeof artifact.dataset.epgEntryCount !== 'number' || artifact.dataset.epgEntryCount <= 0) {
  fail('dataset.epgEntryCount must be a positive number.');
}

if (typeof artifact.dataset.nowMs !== 'number' || artifact.dataset.nowMs <= 0) {
  fail('dataset.nowMs must be a positive number.');
}

if (!artifact.metrics || typeof artifact.metrics !== 'object') {
  fail('metrics object is required.');
}

const startup = artifact.metrics.startup;
if (!startup || typeof startup !== 'object') {
  fail('metrics.startup is required.');
}

if (typeof startup.thresholdP95 !== 'number' || startup.thresholdP95 <= 0) {
  fail('metrics.startup.thresholdP95 must be a positive number.');
}

if (typeof startup.thresholdP99 !== 'number' || startup.thresholdP99 <= 0) {
  fail('metrics.startup.thresholdP99 must be a positive number.');
}

if (!allowedMetricStatus.has(startup.status)) {
  fail('metrics.startup.status must be pending/pass/fail.');
}

if (typeof startup.samples !== 'number' || startup.samples < 0) {
  fail('metrics.startup.samples must be a non-negative number.');
}

if (typeof startup.evidence !== 'string') {
  fail('metrics.startup.evidence must be a string.');
}

const memory = artifact.metrics.memory;
if (!memory || typeof memory !== 'object') {
  fail('metrics.memory is required.');
}

if (typeof memory.thresholdPeakMb !== 'number' || memory.thresholdPeakMb <= 0) {
  fail('metrics.memory.thresholdPeakMb must be a positive number.');
}

if (!allowedMetricStatus.has(memory.status)) {
  fail('metrics.memory.status must be pending/pass/fail.');
}

if (typeof memory.samples !== 'number' || memory.samples < 0) {
  fail('metrics.memory.samples must be a non-negative number.');
}

if (typeof memory.evidence !== 'string') {
  fail('metrics.memory.evidence must be a string.');
}

const failureRate = artifact.metrics.failureRate;
if (!failureRate || typeof failureRate !== 'object') {
  fail('metrics.failureRate is required.');
}

if (typeof failureRate.thresholdPercent !== 'number' || failureRate.thresholdPercent < 0) {
  fail('metrics.failureRate.thresholdPercent must be a non-negative number.');
}

if (!allowedMetricStatus.has(failureRate.status)) {
  fail('metrics.failureRate.status must be pending/pass/fail.');
}

if (!Number.isInteger(failureRate.totalRuns) || failureRate.totalRuns < 0) {
  fail('metrics.failureRate.totalRuns must be a non-negative integer.');
}

if (!Number.isInteger(failureRate.failedRuns) || failureRate.failedRuns < 0) {
  fail('metrics.failureRate.failedRuns must be a non-negative integer.');
}

if (failureRate.failedRuns > failureRate.totalRuns) {
  fail('metrics.failureRate.failedRuns must be <= totalRuns.');
}

if (typeof failureRate.evidence !== 'string') {
  fail('metrics.failureRate.evidence must be a string.');
}

if (failureRate.ratePercent != null) {
  if (!isFiniteNumber(failureRate.ratePercent)) {
    fail('metrics.failureRate.ratePercent must be null or a finite number.');
  }
  const expectedRate = failureRate.totalRuns === 0 ? 0 : (failureRate.failedRuns / failureRate.totalRuns) * 100;
  if (Math.abs(failureRate.ratePercent - expectedRate) > 0.001) {
    fail('metrics.failureRate.ratePercent must match failedRuns / totalRuns.');
  }
}

if (startup.status === 'pass' || startup.status === 'fail') {
  if (startup.p95 == null || startup.p99 == null) {
    fail('metrics.startup p95/p99 must be set when startup.status is pass/fail.');
  }
  if (!isFiniteNumber(startup.p95) || !isFiniteNumber(startup.p99)) {
    fail('metrics.startup p95/p99 must be finite numbers when startup.status is pass/fail.');
  }
  if (!isNonEmptyString(startup.evidence)) {
    fail('metrics.startup.evidence must be set when startup.status is pass/fail.');
  }
}

if (memory.status === 'pass' || memory.status === 'fail') {
  if (memory.peakRssMb == null || memory.p95RssMb == null) {
    fail('metrics.memory peakRssMb/p95RssMb must be set when memory.status is pass/fail.');
  }
  if (!isFiniteNumber(memory.peakRssMb) || !isFiniteNumber(memory.p95RssMb)) {
    fail('metrics.memory peakRssMb/p95RssMb must be finite numbers when memory.status is pass/fail.');
  }
  if (!isNonEmptyString(memory.evidence)) {
    fail('metrics.memory.evidence must be set when memory.status is pass/fail.');
  }
}

if (failureRate.status === 'pass' || failureRate.status === 'fail') {
  if (failureRate.ratePercent == null) {
    fail('metrics.failureRate.ratePercent must be set when failureRate.status is pass/fail.');
  }
  if (!isNonEmptyString(failureRate.evidence)) {
    fail('metrics.failureRate.evidence must be set when failureRate.status is pass/fail.');
  }
}

if (!artifact.signoff || typeof artifact.signoff !== 'object') {
  fail('signoff object is required.');
}

if (!allowedSignoffStatus.has(artifact.signoff.status)) {
  fail('signoff.status must be pending/pass/fail.');
}

if (requireFinal) {
  if (startup.p95 == null || startup.p99 == null) {
    fail('startup p95/p99 must be set with --require-final.');
  }

  if (memory.peakRssMb == null || memory.p95RssMb == null) {
    fail('memory peakRssMb/p95RssMb must be set with --require-final.');
  }

  if (failureRate.ratePercent == null) {
    fail('failureRate.ratePercent must be set with --require-final.');
  }

  if (!isFiniteNumber(startup.p95) || !isFiniteNumber(startup.p99)) {
    fail('startup p95/p99 must be finite numbers.');
  }

  if (!isFiniteNumber(memory.peakRssMb) || !isFiniteNumber(memory.p95RssMb)) {
    fail('memory peakRssMb/p95RssMb must be finite numbers.');
  }

  if (!isFiniteNumber(failureRate.ratePercent)) {
    fail('failureRate.ratePercent must be a finite number.');
  }

  if (startup.status === 'pending' || memory.status === 'pending' || failureRate.status === 'pending') {
    fail('metric statuses cannot be pending with --require-final.');
  }

  if (artifact.signoff.status === 'pending') {
    fail('signoff.status cannot be pending with --require-final.');
  }

  if (typeof artifact.signoff.approvedBy !== 'string' || artifact.signoff.approvedBy.trim() === '') {
    fail('signoff.approvedBy must be set with --require-final.');
  }

  if (typeof artifact.signoff.approvedAt !== 'string' || artifact.signoff.approvedAt.trim() === '') {
    fail('signoff.approvedAt must be set with --require-final.');
  }

  if (startup.status !== 'fail' && startup.p95 > startup.thresholdP95) {
    fail('startup.p95 exceeds threshold while startup.status is not fail.');
  }

  if (startup.status !== 'fail' && startup.p99 > startup.thresholdP99) {
    fail('startup.p99 exceeds threshold while startup.status is not fail.');
  }

  if (memory.status !== 'fail' && memory.peakRssMb > memory.thresholdPeakMb) {
    fail('memory.peakRssMb exceeds threshold while memory.status is not fail.');
  }

  if (failureRate.status !== 'fail' && failureRate.ratePercent > failureRate.thresholdPercent) {
    fail('failureRate.ratePercent exceeds threshold while failureRate.status is not fail.');
  }

  if (artifact.signoff.status === 'pass' && (startup.status === 'fail' || memory.status === 'fail' || failureRate.status === 'fail')) {
    fail('signoff.status cannot be pass when any metric status is fail.');
  }
}

console.log(`[perf-evidence] OK: ${filePath}`);
console.log(`[perf-evidence] require-final: ${requireFinal ? 'yes' : 'no'}`);
