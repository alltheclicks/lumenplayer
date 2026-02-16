#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const allowedStatus = new Set(['pending', 'pass', 'fail']);
const requiredStorageKeys = new Set([
  'xtream_credentials',
  'app_settings',
  'theme_preference',
  'watch-history',
  'push_subscriptions_v1',
  'push_device_id',
  'xmltv_epg_cache',
]);
const requiredControlIds = new Set([
  'storage-namespacing',
  'credentials-clear-on-logout',
  'retention-defined',
  'incident-owner-assigned',
]);

const usage = () => {
  console.error('Usage: node scripts/release/validate-security-privacy-baseline.mjs <file> [--require-final]');
};

const [, , fileArg, ...flags] = process.argv;
if (!fileArg) {
  usage();
  process.exit(1);
}

const requireFinal = flags.includes('--require-final');
const filePath = path.resolve(process.cwd(), fileArg);

const fail = (message) => {
  console.error(`[security-baseline] ERROR: ${message}`);
  process.exit(2);
};

let baseline;
try {
  baseline = JSON.parse(fs.readFileSync(filePath, 'utf8'));
} catch {
  fail(`Unable to read/parse JSON file: ${filePath}`);
}

if (!baseline.clientStorage || typeof baseline.clientStorage !== 'object') {
  fail('clientStorage section is required.');
}

if (typeof baseline.clientStorage.namespacedStorePrefix !== 'string' || baseline.clientStorage.namespacedStorePrefix.trim() === '') {
  fail('clientStorage.namespacedStorePrefix is required.');
}

if (!Array.isArray(baseline.clientStorage.allowedKeys) || baseline.clientStorage.allowedKeys.length === 0) {
  fail('clientStorage.allowedKeys must be a non-empty array.');
}

const seenStorageKeys = new Set();
for (const keyEntry of baseline.clientStorage.allowedKeys) {
  if (!keyEntry || typeof keyEntry !== 'object') {
    fail('each clientStorage.allowedKeys entry must be an object.');
  }

  if (typeof keyEntry.key !== 'string' || keyEntry.key.trim() === '') {
    fail('each clientStorage.allowedKeys entry requires key.');
  }

  if (seenStorageKeys.has(keyEntry.key)) {
    fail(`duplicate clientStorage key entry: ${keyEntry.key}`);
  }

  if (typeof keyEntry.storageType !== 'string' || keyEntry.storageType.trim() === '') {
    fail(`clientStorage key ${keyEntry.key} requires storageType.`);
  }

  if (typeof keyEntry.dataClass !== 'string' || keyEntry.dataClass.trim() === '') {
    fail(`clientStorage key ${keyEntry.key} requires dataClass.`);
  }

  if (typeof keyEntry.retention !== 'string' || keyEntry.retention.trim() === '') {
    fail(`clientStorage key ${keyEntry.key} requires retention policy text.`);
  }

  seenStorageKeys.add(keyEntry.key);
}

for (const key of requiredStorageKeys) {
  if (!seenStorageKeys.has(key)) {
    fail(`required clientStorage key is missing: ${key}`);
  }
}

if (!baseline.retentionPolicy || typeof baseline.retentionPolicy !== 'object') {
  fail('retentionPolicy section is required.');
}

if (typeof baseline.retentionPolicy.reviewCadenceDays !== 'number' || baseline.retentionPolicy.reviewCadenceDays <= 0) {
  fail('retentionPolicy.reviewCadenceDays must be a positive number.');
}

if (!baseline.incidentReadiness || typeof baseline.incidentReadiness !== 'object') {
  fail('incidentReadiness section is required.');
}

if (typeof baseline.incidentReadiness.notificationSlaHours !== 'number' || baseline.incidentReadiness.notificationSlaHours <= 0) {
  fail('incidentReadiness.notificationSlaHours must be a positive number.');
}

if (!Array.isArray(baseline.controls) || baseline.controls.length === 0) {
  fail('controls must be a non-empty array.');
}

const seenControlIds = new Set();
for (const control of baseline.controls) {
  if (!control || typeof control !== 'object') {
    fail('each controls entry must be an object.');
  }

  if (typeof control.id !== 'string' || control.id.trim() === '') {
    fail('control.id is required.');
  }

  if (seenControlIds.has(control.id)) {
    fail(`duplicate control id: ${control.id}`);
  }

  if (!allowedStatus.has(control.status)) {
    fail(`control ${control.id} has invalid status: ${control.status}`);
  }

  if (typeof control.description !== 'string' || control.description.trim() === '') {
    fail(`control ${control.id} requires description.`);
  }

  seenControlIds.add(control.id);
}

for (const id of requiredControlIds) {
  if (!seenControlIds.has(id)) {
    fail(`required control is missing: ${id}`);
  }
}

if (!baseline.signoff || typeof baseline.signoff !== 'object') {
  fail('signoff object is required.');
}

if (!allowedStatus.has(baseline.signoff.status)) {
  fail('signoff.status must be pending/pass/fail.');
}

if (requireFinal) {
  const pendingControls = baseline.controls.filter((control) => control.status === 'pending');
  if (pendingControls.length > 0) {
    fail('controls cannot remain pending with --require-final.');
  }

  if (typeof baseline.incidentReadiness.runbookRef !== 'string' || baseline.incidentReadiness.runbookRef.trim() === '') {
    fail('incidentReadiness.runbookRef must be set with --require-final.');
  }

  if (typeof baseline.incidentReadiness.owner !== 'string' || baseline.incidentReadiness.owner.trim() === '') {
    fail('incidentReadiness.owner must be set with --require-final.');
  }

  if (typeof baseline.incidentReadiness.responseChannel !== 'string' || baseline.incidentReadiness.responseChannel.trim() === '') {
    fail('incidentReadiness.responseChannel must be set with --require-final.');
  }

  if (baseline.signoff.status === 'pending') {
    fail('signoff.status cannot be pending with --require-final.');
  }

  if (typeof baseline.signoff.approvedBy !== 'string' || baseline.signoff.approvedBy.trim() === '') {
    fail('signoff.approvedBy must be set with --require-final.');
  }

  if (typeof baseline.signoff.approvedAt !== 'string' || baseline.signoff.approvedAt.trim() === '') {
    fail('signoff.approvedAt must be set with --require-final.');
  }

  const failedControls = baseline.controls.filter((control) => control.status === 'fail');
  if (baseline.signoff.status === 'pass' && failedControls.length > 0) {
    fail('signoff.status cannot be pass while any control status is fail.');
  }
}

console.log(`[security-baseline] OK: ${filePath}`);
console.log(`[security-baseline] controls: ${baseline.controls.length}`);
console.log(`[security-baseline] require-final: ${requireFinal ? 'yes' : 'no'}`);
