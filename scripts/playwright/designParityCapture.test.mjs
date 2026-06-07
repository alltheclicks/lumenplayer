import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DESIGN_PARITY_ARTIFACT,
  DEFAULT_DESIGN_PARITY_VIEWPORTS,
  normalizeBaseUrl,
  renderDesignParityCaptureMarkdown,
  resolveDesignParityCredentials,
  screenCaptureFileName,
} from './designParityCapture.mjs';

describe('design parity capture config', () => {
  it('uses QAF-035 design artifact and reference viewport sizes by default', () => {
    expect(DEFAULT_DESIGN_PARITY_ARTIFACT).toBe(
      'artifacts/release/design/qaf035-design-parity-20260603.json',
    );
    expect(DEFAULT_DESIGN_PARITY_VIEWPORTS).toEqual({
      desktop: { width: 1440, height: 900 },
      mobile: { width: 390, height: 844 },
    });
  });

  it('normalizes base URL and credentials', () => {
    expect(normalizeBaseUrl('https://app.example.test/')).toBe('https://app.example.test');
    expect(resolveDesignParityCredentials({
      VITE_XTREAM_SERVER: 'https://gw.castcdn.net:443/',
      E2E_XUI_USERNAME: 'demo',
      E2E_XUI_PASSWORD: 'demo',
    })).toEqual({
      server: 'https://gw.castcdn.net:443',
      username: 'demo',
      password: 'demo',
    });
  });

  it('uses stable capture file names', () => {
    expect(screenCaptureFileName('player', 'desktop')).toBe('lumen-player-desktop.png');
    expect(screenCaptureFileName('movies', 'mobile')).toBe('lumen-movies-mobile.png');
  });

  it('renders a concise capture report without credentials', () => {
    const markdown = renderDesignParityCaptureMarkdown({
      status: 'pass',
      baseUrl: 'https://app.example.test',
      artifactPath: DEFAULT_DESIGN_PARITY_ARTIFACT,
      generatedAt: '2026-06-05T00:00:00.000Z',
      captures: [{
        screenId: 'login',
        mode: 'desktop',
        route: '/login',
        file: 'output/playwright/lp-0373/lumen-login-desktop.png',
        status: 'pass',
        viewport: { width: 1440, height: 900 },
      }],
      failures: [],
    });

    expect(markdown).toContain('Status: PASS');
    expect(markdown).toContain('lumen-login-desktop.png');
    expect(markdown).not.toContain('password');
  });
});
