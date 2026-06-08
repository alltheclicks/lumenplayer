import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from './vitest.config';

// Fast unit-test profile (M1.2-d): runs only the application/package source
// tests under apps/**/src and packages/**/src. Excludes the release-gate and
// perf validators in scripts/** so day-to-day `pnpm test:unit` stays quick and
// focused on product code, not the release ceremony.
export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: [
        'apps/**/src/**/*.test.{ts,tsx}',
        'packages/**/src/**/*.test.{ts,tsx}',
      ],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.codex/**',
        '**/output/**',
        '**/test-results/**',
        '**/e2e/**',
        'scripts/**',
      ],
    },
  }),
);
