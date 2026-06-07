import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MOBILE_LAYOUT_ROUTES,
  DEFAULT_MOBILE_LAYOUT_VIEWPORT,
  normalizeBaseUrl,
  parseCommaSeparatedRoutes,
  parseViewport,
  renderMobileLayoutSmokeMarkdown,
  resolveMobileLayoutCredentials,
} from './mobileLayoutSmoke.mjs';

describe('mobile layout smoke config', () => {
  it('parses routes with a stable default', () => {
    expect(parseCommaSeparatedRoutes(undefined)).toEqual(DEFAULT_MOBILE_LAYOUT_ROUTES);
    expect(parseCommaSeparatedRoutes(' player, /vod ,, settings ')).toEqual([
      '/player',
      '/vod',
      '/settings',
    ]);
  });

  it('parses and clamps the mobile viewport', () => {
    expect(parseViewport(undefined)).toEqual(DEFAULT_MOBILE_LAYOUT_VIEWPORT);
    expect(parseViewport('393x660')).toEqual({ width: 393, height: 660 });
    expect(parseViewport('200x300')).toEqual({ width: 320, height: 480 });
    expect(parseViewport('bad')).toEqual(DEFAULT_MOBILE_LAYOUT_VIEWPORT);
  });

  it('normalizes the base URL without changing the protocol or host', () => {
    expect(normalizeBaseUrl('https://example.test/player/')).toBe('https://example.test/player');
    expect(normalizeBaseUrl('http://127.0.0.1:8080/')).toBe('http://127.0.0.1:8080');
  });

  it('uses demo credentials by default and strips trailing server slashes', () => {
    expect(resolveMobileLayoutCredentials({
      VITE_XTREAM_SERVER: 'https://gw.castcdn.net:443/',
    })).toEqual({
      source: 'demo-default',
      credentials: {
        server: 'https://gw.castcdn.net:443',
        username: 'demo',
        password: 'demo',
      },
    });
  });

  it('does not render passwords in the markdown report', () => {
    const markdown = renderMobileLayoutSmokeMarkdown({
      status: 'pass',
      baseUrl: 'https://app.test',
      viewport: { width: 393, height: 660 },
      credentialSource: 'env',
      xtreamServer: 'https://gw.castcdn.net:443',
      proxyOrigin: 'https://proxy.test',
      proxyRequestCount: 3,
      routes: [{
        route: '/player',
        status: 'pass',
        metrics: { bodyW: 393, docW: 393 },
        overflowing: [],
        screenshot: 'output/playwright/mobile-layout-smoke/player-mobile.png',
      }],
      catchUpPanel: {
        status: 'pass',
        urlAfterClick: 'https://app.test/player',
        headingVisible: true,
      },
      mixedContentMessages: [],
      failedRequests: [],
    });

    expect(markdown).toContain('Status: PASS');
    expect(markdown).toContain('Xtream server: https://gw.castcdn.net:443');
    expect(markdown).not.toContain('password');
  });
});
