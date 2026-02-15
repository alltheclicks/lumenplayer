import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const resolvePath = (relativePath: string): string => (
  fileURLToPath(new URL(relativePath, import.meta.url))
);

export default defineConfig({
  resolve: {
    alias: {
      '@lumen/api': resolvePath('./packages/api/src/index.ts'),
      '@lumen/core': resolvePath('./packages/core/src/index.ts'),
      '@lumen/demo-data': resolvePath('./packages/demo-data/src/index.ts'),
      '@lumen/input': resolvePath('./packages/input/src/index.ts'),
      '@lumen/player-core': resolvePath('./packages/player-core/src/index.ts'),
      '@lumen/session-core': resolvePath('./packages/session-core/src/index.ts'),
      '@lumen/storage': resolvePath('./packages/storage/src/index.ts'),
      '@lumen/types': resolvePath('./packages/types/src/index.ts'),
    },
  },
});
