import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = join(__dirname, '..');

// For CI, you may want to set BASE_URL to the deployed application.
const baseURL = process.env['BASE_URL'] || 'http://localhost:18601';

/**
 * See https://playwright.dev/docs/test-configuration.
 *
 * Plain Playwright config (no @nx/playwright preset) to avoid ESM/CJS
 * interop issues with @nx/devkit in the current toolchain.
 */
export default defineConfig({
  testDir: './src',
  globalSetup: './src/global-setup.ts',
  outputDir: join(workspaceRoot, 'dist', '.playwright', 'e2e', 'test-output'),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['html', { outputFolder: join(workspaceRoot, 'dist', '.playwright', 'e2e', 'playwright-report'), open: 'on-failure' }]],
  /* Shared settings for all the projects below. */
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'pnpm nx run-many -t serve -p api,web',
    url: 'http://localhost:18601',
    reuseExistingServer: false,
    cwd: workspaceRoot,
    env: {
      CLERK_BYPASS_AUTH: 'true',
      AUTH_BYPASS_TOKEN: 'test_token',
      PAYMENT_PROVIDER: 'test',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
