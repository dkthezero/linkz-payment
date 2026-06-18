/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths({ root: '../' })],
  test: {
    globals: true,
    environment: 'node',
    cacheDir: '../node_modules/.vitest',
    include: ['src/**/*.{spec,test}.ts'],
    setupFiles: ['./vitest.setup.ts'],
  },
});