/// <reference types="vitest" />
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../node_modules/.vite/web',
  server: {
    port: 18601,
    proxy: { '/api': 'http://localhost:18600' },
  },
  build: { target: 'esnext', outDir: '../dist/web' },
  plugins: [solidPlugin(), tsconfigPaths()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{js,ts,jsx,tsx}'],
  },
});