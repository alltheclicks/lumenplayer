import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

export const DEFAULT_MOBILE_LAYOUT_ROUTES = ['/player', '/vod', '/series', '/epg', '/settings'];
export const DEFAULT_MOBILE_LAYOUT_VIEWPORT = { width: 393, height: 660 };
export const STORAGE_CREDENTIALS_KEY = 'lumen-web:v1:xtream_credentials';
export const STORAGE_KEYS_KEY = 'lumen-web:v1:__keys__';

export const parseCommaSeparatedRoutes = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return DEFAULT_MOBILE_LAYOUT_ROUTES;
  }

  const routes = value
    .split(',')
    .map((route) => route.trim())
    .filter((route) => route.length > 0)
    .map((route) => (route.startsWith('/') ? route : `/${route}`));

  return routes.length > 0 ? routes : DEFAULT_MOBILE_LAYOUT_ROUTES;
};

export const parseViewport = (value) => {
  if (typeof value !== 'string') {
    return DEFAULT_MOBILE_LAYOUT_VIEWPORT;
  }

  const match = value.trim().match(/^(\d+)x(\d+)$/i);
  if (!match) {
    return DEFAULT_MOBILE_LAYOUT_VIEWPORT;
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return DEFAULT_MOBILE_LAYOUT_VIEWPORT;
  }

  return {
    width: Math.max(320, width),
    height: Math.max(480, height),
  };
};

export const resolveMobileLayoutCredentials = (env = process.env) => {
  const server = (
    env.E2E_XTREAM_SERVER ||
    env.VITE_XTREAM_SERVER ||
    'https://gw.castcdn.net:443'
  ).trim().replace(/\/+$/, '');
  const username = env.E2E_XUI_USERNAME || env.VITE_XUI_USERNAME || 'demo';
  const password = env.E2E_XUI_PASSWORD || env.VITE_XUI_PASSWORD || 'demo';

  return {
    source: username === 'demo' && password === 'demo' ? 'demo-default' : 'env',
    credentials: {
      server,
      username,
      password,
    },
  };
};

export const normalizeBaseUrl = (value) => (
  (value || 'http://127.0.0.1:8080').trim().replace(/\/+$/, '')
);

export const renderMobileLayoutSmokeMarkdown = (report) => {
  const lines = [
    '# Mobile layout smoke',
    '',
    `- Status: ${report.status.toUpperCase()}`,
    `- Base URL: ${report.baseUrl}`,
    `- Viewport: ${report.viewport.width}x${report.viewport.height}`,
    `- Credential source: ${report.credentialSource}`,
    `- Xtream server: ${report.xtreamServer}`,
  ];

  if (report.proxyOrigin) {
    lines.push(
      `- Proxy origin: ${report.proxyOrigin}`,
      `- Proxy requests observed: ${report.proxyRequestCount}`,
    );
  }

  lines.push('', '## Routes', '');
  for (const route of report.routes) {
    lines.push(
      `- ${route.route}: ${route.status.toUpperCase()} bodyW=${route.metrics.bodyW} docW=${route.metrics.docW} overflow=${route.overflowing.length} screenshot=${route.screenshot}`,
    );
  }

  lines.push(
    '',
    '## TV Unazad',
    '',
    `- Top button status: ${report.catchUpPanel.status.toUpperCase()}`,
    `- Top button URL after click: ${report.catchUpPanel.urlAfterClick}`,
    `- Top button heading visible: ${report.catchUpPanel.headingVisible}`,
    `- Top button screenshot: ${report.catchUpPanel.topButtonScreenshot ?? 'n/a'}`,
    `- Control icon status: ${report.catchUpPanel.controlIconStatus?.toUpperCase?.() ?? 'UNKNOWN'}`,
    `- Control icon URL after click: ${report.catchUpPanel.controlIconUrlAfterClick ?? 'n/a'}`,
    `- Control icon heading visible: ${report.catchUpPanel.controlIconHeadingVisible ?? false}`,
    `- Control icon screenshot: ${report.catchUpPanel.controlIconScreenshot ?? 'n/a'}`,
  );

  if (report.mixedContentMessages.length > 0) {
    lines.push('', '## Mixed Content Messages', '');
    for (const message of report.mixedContentMessages) {
      lines.push(`- ${message}`);
    }
  }

  if (report.failedRequests.length > 0) {
    lines.push('', '## Failed Requests', '');
    for (const request of report.failedRequests) {
      lines.push(`- ${request}`);
    }
  }

  return `${lines.join('\n')}\n`;
};

const collectMobileLayoutMetrics = async (page) => page.evaluate(() => {
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const hasScrollableAncestor = (element) => {
    let node = element.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      const style = window.getComputedStyle(node);
      if (
        (style.overflowX === 'auto' || style.overflowX === 'scroll') &&
        node.scrollWidth > node.clientWidth + 1
      ) {
        return true;
      }
      node = node.parentElement;
    }
    return false;
  };

  const overflowing = Array.from(document.querySelectorAll('body *'))
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        tag: element.tagName,
        className: String(element.getAttribute('class') ?? '').slice(0, 180),
        text: String(element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 120),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        scrollableAncestor: hasScrollableAncestor(element),
      };
    })
    .filter((entry) => (
      entry.width > 0 &&
      (entry.left < -1 || entry.right > viewportW + 1) &&
      !entry.scrollableAncestor
    ))
    .slice(0, 30);

  return {
    metrics: {
      href: window.location.href,
      title: document.title,
      viewportW,
      viewportH,
      visualViewportW: Math.round(window.visualViewport?.width ?? viewportW),
      visualViewportH: Math.round(window.visualViewport?.height ?? viewportH),
      scrollX: Math.round(window.scrollX),
      rootLeft: Math.round(document.documentElement.getBoundingClientRect().left),
      rootRight: Math.round(document.documentElement.getBoundingClientRect().right),
      bodyW: document.body.scrollWidth,
      bodyH: document.body.scrollHeight,
      docW: document.documentElement.scrollWidth,
      docH: document.documentElement.scrollHeight,
    },
    overflowing,
  };
});

const routePasses = ({ metrics, overflowing }) => (
  metrics.bodyW <= metrics.viewportW + 1 &&
  metrics.docW <= metrics.viewportW + 1 &&
  Math.abs(metrics.scrollX) <= 1 &&
  metrics.rootLeft >= -1 &&
  metrics.rootRight <= metrics.viewportW + 1 &&
  overflowing.length === 0
);

export const runMobileLayoutSmoke = async ({
  baseUrl = normalizeBaseUrl(process.env.E2E_MOBILE_LAYOUT_BASE_URL),
  outDir = resolve(process.cwd(), 'output/playwright/mobile-layout-smoke'),
  routes = parseCommaSeparatedRoutes(process.env.E2E_MOBILE_LAYOUT_ROUTES),
  viewport = parseViewport(process.env.E2E_MOBILE_LAYOUT_VIEWPORT),
  proxyOrigin = process.env.E2E_MOBILE_LAYOUT_PROXY_ORIGIN?.trim().replace(/\/+$/, '') || '',
  headless = process.env.E2E_HEADLESS !== 'false',
  env = process.env,
} = {}) => {
  mkdirSync(outDir, { recursive: true });
  const credentialResolution = resolveMobileLayoutCredentials(env);
  const consoleMessages = [];
  const failedRequests = [];
  const proxyRequests = [];
  const browser = await chromium.launch({ headless });

  try {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();

    page.on('console', (message) => {
      const text = message.text();
      if (/mixed content|blocked/i.test(text)) {
        consoleMessages.push(text);
      }
    });
    page.on('request', (request) => {
      const url = request.url();
      if (proxyOrigin && url.startsWith(proxyOrigin)) {
        proxyRequests.push(url);
      }
    });
    page.on('requestfailed', (request) => {
      const url = request.url();
      const errorText = request.failure()?.errorText ?? 'unknown';
      if (
        (url.startsWith(baseUrl) || (proxyOrigin && url.startsWith(proxyOrigin))) &&
        errorText !== 'net::ERR_ABORTED'
      ) {
        failedRequests.push(`${url} :: ${errorText}`);
      }
    });

    await page.addInitScript(({ credentials, storageKey, storageKeysKey }) => {
      window.localStorage.setItem(storageKey, JSON.stringify(credentials));
      window.localStorage.setItem(storageKeysKey, JSON.stringify([storageKey]));
    }, {
      credentials: credentialResolution.credentials,
      storageKey: STORAGE_CREDENTIALS_KEY,
      storageKeysKey: STORAGE_KEYS_KEY,
    });

    const routeReports = [];
    for (const route of routes) {
      await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(900);
      const snapshot = await collectMobileLayoutMetrics(page);
      const screenshot = `output/playwright/mobile-layout-smoke/${route.replace(/^\//, '') || 'root'}-mobile.png`;
      await page.screenshot({
        path: resolve(process.cwd(), screenshot),
        fullPage: true,
      });
      routeReports.push({
        route,
        status: routePasses(snapshot) ? 'pass' : 'fail',
        screenshot,
        ...snapshot,
      });
    }

    await page.goto(`${baseUrl}/player`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(900);
    const catchUpPanel = {
      status: 'fail',
      urlAfterClick: page.url(),
      headingVisible: false,
      topButtonScreenshot: '',
      controlIconStatus: 'fail',
      controlIconUrlAfterClick: page.url(),
      controlIconHeadingVisible: false,
      controlIconScreenshot: '',
      error: '',
      controlIconError: '',
    };
    try {
      await page.getByRole('button', { name: /^TV Unazad$/i }).first().click({ timeout: 15_000 });
      await page.getByRole('heading', { name: 'Gledanje unazad' }).waitFor({
        state: 'visible',
        timeout: 10_000,
      });
      catchUpPanel.urlAfterClick = page.url();
      catchUpPanel.headingVisible = true;
      catchUpPanel.topButtonScreenshot = 'output/playwright/mobile-layout-smoke/player-catchup-top-button-mobile.png';
      await page.screenshot({
        path: resolve(process.cwd(), catchUpPanel.topButtonScreenshot),
        fullPage: false,
      });
      catchUpPanel.status = new URL(catchUpPanel.urlAfterClick).pathname === '/player'
        ? 'pass'
        : 'fail';
    } catch (error) {
      catchUpPanel.urlAfterClick = page.url();
      catchUpPanel.error = error?.message ?? String(error);
    }

    try {
      await page.getByRole('button', { name: /^Zatvori TV unazad$/i }).click({ timeout: 5_000 });
    } catch {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(900);
    }

    try {
      await page.getByTestId('catchup-open').first().click({ timeout: 15_000 });
      await page.getByRole('heading', { name: 'Gledanje unazad' }).waitFor({
        state: 'visible',
        timeout: 10_000,
      });
      catchUpPanel.controlIconUrlAfterClick = page.url();
      catchUpPanel.controlIconHeadingVisible = true;
      catchUpPanel.controlIconScreenshot = 'output/playwright/mobile-layout-smoke/player-catchup-control-icon-mobile.png';
      await page.screenshot({
        path: resolve(process.cwd(), catchUpPanel.controlIconScreenshot),
        fullPage: false,
      });
      catchUpPanel.controlIconStatus = new URL(catchUpPanel.controlIconUrlAfterClick).pathname === '/player'
        ? 'pass'
        : 'fail';
    } catch (error) {
      catchUpPanel.controlIconUrlAfterClick = page.url();
      catchUpPanel.controlIconError = error?.message ?? String(error);
    }

    const report = {
      status: (
        routeReports.every((routeReport) => routeReport.status === 'pass') &&
        catchUpPanel.status === 'pass' &&
        catchUpPanel.controlIconStatus === 'pass' &&
        consoleMessages.length === 0 &&
        failedRequests.length === 0 &&
        (!proxyOrigin || proxyRequests.length > 0)
      ) ? 'pass' : 'fail',
      generatedAt: new Date().toISOString(),
      baseUrl,
      viewport,
      routes: routeReports,
      catchUpPanel,
      proxyOrigin,
      proxyRequestCount: proxyRequests.length,
      proxyRequestSamples: proxyRequests.slice(0, 10),
      mixedContentMessages: consoleMessages,
      failedRequests,
      credentialSource: credentialResolution.source,
      xtreamServer: credentialResolution.credentials.server,
    };

    writeFileSync(resolve(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
    writeFileSync(resolve(outDir, 'REPORT.md'), renderMobileLayoutSmokeMarkdown(report), 'utf-8');
    return report;
  } finally {
    await browser.close();
  }
};
