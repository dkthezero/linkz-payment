import { test, expect } from '@playwright/test';

test('API health endpoint returns ok', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBeTruthy();
  await expect(res.json()).resolves.toEqual({ status: 'ok' });
});
