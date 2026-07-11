#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const args = process.argv.slice(2);

const fail = (message) => {
  console.error(`[pwa-readiness] ERROR: ${message}`);
  process.exit(2);
};

if (args.length > 0) {
  fail(`Unknown argument(s): ${args.join(', ')}`);
}

const files = {
  guide: 'docs/qa/qaf035-real-device-qa-guide.md',
  runbook: 'docs/release/qaf035-beta-signoff-runbook.md',
  viteConfig: 'apps/web/vite.config.ts',
  indexHtml: 'apps/web/index.html',
  offlineHtml: 'apps/web/public/offline.html',
  pushHandlers: 'apps/web/public/sw-push-handlers.js',
  usePwa: 'apps/web/src/hooks/usePWA.ts',
  settings: 'apps/web/src/pages/Settings.tsx',
};

const requiredAssets = [
  'apps/web/public/pwa-192x192.png',
  'apps/web/public/pwa-512x512.png',
  'apps/web/public/pwa-maskable-512x512.png',
  'apps/web/public/apple-touch-icon.png',
  'apps/web/public/apple-splash-1179x2556.png',
  'apps/web/public/apple-splash-1290x2796.png',
  'apps/web/public/apple-splash-1536x2048.png',
  'apps/web/public/apple-splash-1668x2388.png',
];

const readText = (filePath) => {
  const absolutePath = path.resolve(repoRoot, filePath);
  if (!fs.existsSync(absolutePath)) {
    fail(`Missing file: ${filePath}`);
  }

  return fs.readFileSync(absolutePath, 'utf8');
};

const requireSnippets = (label, content, snippets) => {
  for (const snippet of snippets) {
    if (!content.includes(snippet)) {
      fail(`${label} must include: ${snippet}`);
    }
  }
};

for (const asset of requiredAssets) {
  const absolutePath = path.resolve(repoRoot, asset);
  if (!fs.existsSync(absolutePath)) {
    fail(`Missing PWA asset: ${asset}`);
  }
  if (fs.statSync(absolutePath).size <= 0) {
    fail(`PWA asset is empty: ${asset}`);
  }
}

const guide = readText(files.guide);
const runbook = readText(files.runbook);
const viteConfig = readText(files.viteConfig);
const indexHtml = readText(files.indexHtml);
const offlineHtml = readText(files.offlineHtml);
const pushHandlers = readText(files.pushHandlers);
const usePwa = readText(files.usePwa);
const settings = readText(files.settings);

requireSnippets(files.guide, guide, [
  'HTTPS, PWA, And Cast Scope',
  'Final PWA install/offline',
  'PWA install prompt or Add to Home Screen',
  'PWA offline shell and reconnect recovery',
  '`pwa-install-offline`',
  'Install, launch installed shell, offline shell, reconnect recovery. HTTPS required.',
  'The smoke report is not final real-device evidence.',
]);

requireSnippets(files.runbook, runbook, [
  '`pwa-install-offline`',
  'Install prompt/installed launch, offline shell, online playback recovery.',
]);

requireSnippets(files.viteConfig, viteConfig, [
  'VitePWA({',
  'registerType: "autoUpdate"',
  'manifest: {',
  'name: brandName',
  'short_name: brandShort',
  'display: "standalone"',
  'start_url: "/"',
  'scope: "/"',
  'pwa-192x192.png',
  'pwa-512x512.png',
  'pwa-maskable-512x512.png',
  'purpose: "maskable"',
  'workbox: {',
  'importScripts: ["sw-push-handlers.js"]',
  'globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"]',
  'request.mode === "navigate"',
  'handler: "NetworkFirst"',
  'networkTimeoutSeconds: 3',
  'precacheFallback',
  'fallbackURL: "/offline.html"',
]);

requireSnippets(files.indexHtml, indexHtml, [
  '<link rel="manifest" href="/manifest.webmanifest" />',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
  'apple-touch-startup-image',
  'apple-splash-1179x2556.png',
  'apple-splash-1290x2796.png',
  'apple-splash-1536x2048.png',
  'apple-splash-1668x2388.png',
  '<meta name="theme-color" content="#3B77F7" />',
]);

requireSnippets(files.offlineHtml, offlineHtml, [
  '<title>Offline</title>',
  '<h1>You are offline</h1>',
  'window.location.reload()',
  '<a href="/">Open app</a>',
  'could not reach the network',
]);

requireSnippets(files.pushHandlers, pushHandlers, [
  "self.addEventListener('push'",
  "self.addEventListener('notificationclick'",
  'normalizeTargetPath',
  "return '/settings';",
  "icon: '/pwa-192x192.png'",
  "badge: '/pwa-192x192.png'",
  'clients.openWindow(targetUrl)',
]);

requireSnippets(files.usePwa, usePwa, [
  "window.matchMedia('(display-mode: standalone)').matches",
  'window.navigator',
  'beforeinstallprompt',
  'appinstalled',
  "window.addEventListener('online'",
  "window.addEventListener('offline'",
  'promptInstall',
]);

requireSnippets(files.settings, settings, [
  'Install App',
  'Install app',
  'You are online',
  'You are offline',
  'Add to Home Screen',
  'Chrome',
]);

console.log('[pwa-readiness] OK');
console.log(`[pwa-readiness] guide: ${files.guide}`);
console.log(`[pwa-readiness] vite: ${files.viteConfig}`);
