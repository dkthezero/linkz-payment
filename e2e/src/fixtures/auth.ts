import type { Page } from '@playwright/test';

export const BYPASS_AUTH_KEY = 'linkz:bypass-auth';
export const BYPASS_TOKEN = 'test_token';

export async function signInAsTestUser(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    localStorage.setItem(key, 'true');
  }, BYPASS_AUTH_KEY);
}

export function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${BYPASS_TOKEN}` };
}
