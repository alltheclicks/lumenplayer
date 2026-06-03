#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const allowedStatus = new Set(['pending', 'pass', 'fail']);
const requiredForbiddenPatterns = [
  '__remux__',
  '__lumenTransport=remux-hls',
  'LUMEN_PROXY_REMUX_ENABLED=1',
  'proxy-remuxed',
  'remux-hls',
  'remux',
  'ffmpeg',
  'ffprobe',
  'transcode',
  'server-side media processing',
  'server-side transcode',
  'server-side remux',
  'generated HLS',
  'XUI media processing',
  'XUI-side media processing',
];

const usage = () => {
  console.error('Usage: node scripts/release/validate-no-media-evidence-scan-artifact.mjs <file> [--require-final]');
};

const [, , fileArg, ...flags] = process.argv;
if (!fileArg) {
  usage();
  process.exit(1);
}

const requireFinal = flags.includes('--require-final');
const filePath = path.resolve(process.cwd(), fileArg);

const fail = (message) => {
  console.error(`[no-media-evidence-scan-artifact] ERROR: ${message}`);
  process.exit(2);
};

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const isSha256 = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);

let artifact;
try {
  artifact = JSON.parse(fs.readFileSync(filePath, 'utf8'));
} catch {
  fail(`Unable to read/parse JSON file: ${filePath}`);
}

if (!artifact.source || typeof artifact.source !== 'object') {
  fail('source object is required.');
}
for (const field of ['evidenceRef', 'reportRef', 'rawEvidencePolicy', 'evidenceSha256', 'reportSha256']) {
  if (!isNonEmptyString(artifact.source[field])) {
    fail(`source.${field} must be a non-empty string.`);
  }
}
if (artifact.source.rawEvidenceTracked !== false) {
  fail('source.rawEvidenceTracked must be false.');
}
if (!isSha256(artifact.source.evidenceSha256)) {
  fail('source.evidenceSha256 must be a SHA-256 hex digest.');
}
if (!isSha256(artifact.source.reportSha256)) {
  fail('source.reportSha256 must be a SHA-256 hex digest.');
}

if (!artifact.scan || typeof artifact.scan !== 'object') {
  fail('scan object is required.');
}
if (!allowedStatus.has(artifact.scan.status)) {
  fail('scan.status must be pending/pass/fail.');
}
if (!isNonEmptyString(artifact.scan.command)) {
  fail('scan.command must be a non-empty string.');
}
if (!artifact.scan.command.includes('release:no-media-evidence:scan')) {
  fail('scan.command must reference release:no-media-evidence:scan.');
}
if (!Number.isInteger(artifact.scan.scannedFiles) || artifact.scan.scannedFiles < 0) {
  fail('scan.scannedFiles must be a non-negative integer.');
}
if (!Array.isArray(artifact.scan.forbiddenHits)) {
  fail('scan.forbiddenHits must be an array.');
}
if (!Array.isArray(artifact.scan.forbiddenPatterns)) {
  fail('scan.forbiddenPatterns must be an array.');
}
for (const pattern of requiredForbiddenPatterns) {
  if (!artifact.scan.forbiddenPatterns.includes(pattern)) {
    fail(`scan.forbiddenPatterns must include ${pattern}.`);
  }
}

if (!artifact.summary || typeof artifact.summary !== 'object') {
  fail('summary object is required.');
}
if (!allowedStatus.has(artifact.summary.status)) {
  fail('summary.status must be pending/pass/fail.');
}
for (const field of [
  'requestsCaptured',
  'responsesCaptured',
  'cdpEventsCaptured',
  'disallowedMediaProcessingUrlHits',
  'mediaProcessingProcessesObserved',
]) {
  if (!Number.isInteger(artifact.summary[field]) || artifact.summary[field] < 0) {
    fail(`summary.${field} must be a non-negative integer.`);
  }
}
if (!Array.isArray(artifact.summary.observedHosts)) {
  fail('summary.observedHosts must be an array.');
}

if (requireFinal || artifact.scan.status === 'pass') {
  if (artifact.scan.status !== 'pass') {
    fail('scan.status must be pass with --require-final.');
  }
  if (artifact.summary.status !== 'pass') {
    fail('summary.status must be pass when scan.status is pass.');
  }
  if (artifact.scan.scannedFiles <= 0) {
    fail('scan.scannedFiles must be greater than zero when scan.status is pass.');
  }
  if (artifact.scan.forbiddenHits.length > 0) {
    fail('scan.forbiddenHits must be empty when scan.status is pass.');
  }
  if (artifact.summary.disallowedMediaProcessingUrlHits !== 0) {
    fail('summary.disallowedMediaProcessingUrlHits must be zero when scan.status is pass.');
  }
  if (artifact.summary.mediaProcessingProcessesObserved !== 0) {
    fail('summary.mediaProcessingProcessesObserved must be zero when scan.status is pass.');
  }
}

console.log(`[no-media-evidence-scan-artifact] OK: ${filePath}`);
console.log(`[no-media-evidence-scan-artifact] status: ${artifact.scan.status}`);
