import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

export const DEFAULT_DESIGN_PARITY_ARTIFACT =
  'artifacts/release/design/qaf035-design-parity-20260603.json';
export const DEFAULT_DESIGN_PARITY_OUT_DIR = 'output/playwright/lp-0373';
export const DEFAULT_DESIGN_PARITY_VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};
export const STORAGE_CREDENTIALS_KEY = 'lumen-web:v1:xtream_credentials';
export const STORAGE_KEYS_KEY = 'lumen-web:v1:__keys__';

export const normalizeBaseUrl = (value) => (
  (value || 'http://127.0.0.1:8080').trim().replace(/\/+$/, '')
);

export const resolveDesignParityCredentials = (env = process.env) => ({
  server: (env.E2E_XTREAM_SERVER || env.VITE_XTREAM_SERVER || 'https://gw.castcdn.net:443')
    .trim()
    .replace(/\/+$/, ''),
  username: env.E2E_XUI_USERNAME || env.VITE_XUI_USERNAME || 'demo',
  password: env.E2E_XUI_PASSWORD || env.VITE_XUI_PASSWORD || 'demo',
});

export const screenCaptureFileName = (screenId, mode) => (
  `lumen-${screenId}-${mode}.png`
);

export const loadDesignParityArtifact = (artifactPath = DEFAULT_DESIGN_PARITY_ARTIFACT) => {
  const absolutePath = path.resolve(process.cwd(), artifactPath);
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
};

export const renderDesignParityCaptureMarkdown = (report) => {
  const lines = [
    '# Design parity captures',
    '',
    `- Status: ${report.status.toUpperCase()}`,
    `- Base URL: ${report.baseUrl}`,
    `- Artifact: ${report.artifactPath}`,
    `- Generated at: ${report.generatedAt}`,
    '',
    '## Captures',
    '',
  ];

  for (const capture of report.captures) {
    lines.push(
      `- ${capture.screenId}/${capture.mode}: ${capture.status.toUpperCase()} ${capture.viewport.width}x${capture.viewport.height} route=${capture.route} file=${capture.file}`,
    );
  }

  if (report.failures.length > 0) {
    lines.push('', '## Failures', '');
    for (const failure of report.failures) {
      lines.push(`- ${failure}`);
    }
  }

  return `${lines.join('\n')}\n`;
};

const injectCredentials = async (page, credentials) => {
  await page.addInitScript(({ credentials: injectedCredentials, storageKey, storageKeysKey }) => {
    window.localStorage.setItem(storageKey, JSON.stringify(injectedCredentials));
    window.localStorage.setItem(storageKeysKey, JSON.stringify([storageKey]));
  }, {
    credentials,
    storageKey: STORAGE_CREDENTIALS_KEY,
    storageKeysKey: STORAGE_KEYS_KEY,
  });
};

const captureScreen = async ({
  browser,
  baseUrl,
  credentials,
  mode,
  outDir,
  screen,
  viewport,
}) => {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: mode === 'mobile' ? 3 : 1,
    isMobile: mode === 'mobile',
    hasTouch: mode === 'mobile',
  });
  const page = await context.newPage();

  try {
    if (screen.route !== '/login') {
      await injectCredentials(page, credentials);
    }

    const url = `${baseUrl}${screen.route}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(900);

    const expectedRef = screen[mode]?.lumenRef;
    const file = expectedRef || path.join(outDir, screenCaptureFileName(screen.id, mode));
    const absoluteFile = path.resolve(process.cwd(), file);
    fs.mkdirSync(path.dirname(absoluteFile), { recursive: true });
    await page.screenshot({ path: absoluteFile, fullPage: false, scale: 'css' });

    const metrics = await page.evaluate(() => ({
      href: window.location.href,
      title: document.title,
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
      bodyW: document.body.scrollWidth,
      docW: document.documentElement.scrollWidth,
    }));

    return {
      screenId: screen.id,
      mode,
      route: screen.route,
      file,
      status: 'pass',
      viewport,
      metrics,
    };
  } finally {
    await context.close();
  }
};

export const runDesignParityCapture = async ({
  artifactPath = DEFAULT_DESIGN_PARITY_ARTIFACT,
  baseUrl = normalizeBaseUrl(process.env.E2E_DESIGN_PARITY_BASE_URL),
  credentials = resolveDesignParityCredentials(process.env),
  outDir = DEFAULT_DESIGN_PARITY_OUT_DIR,
  viewports = DEFAULT_DESIGN_PARITY_VIEWPORTS,
  headless = process.env.E2E_HEADLESS !== 'false',
} = {}) => {
  const artifact = loadDesignParityArtifact(artifactPath);
  const outDirAbsolute = path.resolve(process.cwd(), outDir);
  fs.mkdirSync(outDirAbsolute, { recursive: true });

  const browser = await chromium.launch({ headless });
  const captures = [];
  const failures = [];

  try {
    for (const screen of artifact.screens) {
      for (const mode of ['desktop', 'mobile']) {
        try {
          captures.push(await captureScreen({
            browser,
            baseUrl,
            credentials,
            mode,
            outDir,
            screen,
            viewport: viewports[mode],
          }));
        } catch (error) {
          const message = error?.message ?? String(error);
          failures.push(`${screen.id}/${mode}: ${message}`);
          captures.push({
            screenId: screen.id,
            mode,
            route: screen.route,
            file: screen[mode]?.lumenRef ?? path.join(outDir, screenCaptureFileName(screen.id, mode)),
            status: 'fail',
            viewport: viewports[mode],
            error: message,
          });
        }
      }
    }
  } finally {
    await browser.close();
  }

  const report = {
    status: failures.length === 0 ? 'pass' : 'fail',
    generatedAt: new Date().toISOString(),
    artifactPath,
    baseUrl,
    outDir,
    captures,
    failures,
  };

  fs.writeFileSync(path.join(outDirAbsolute, 'capture-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(outDirAbsolute, 'CAPTURE-REPORT.md'), renderDesignParityCaptureMarkdown(report));

  return report;
};
