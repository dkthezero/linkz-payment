import { test, expect } from '@playwright/test';

test('landing page loads and shows LinkZ branding', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.logo')).toContainText('LinkZ');
  await expect(page.locator('h1')).toBeVisible();
});
