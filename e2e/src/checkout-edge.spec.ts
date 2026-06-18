import { expect, test } from '@playwright/test';
import { signInAsTestUser } from './fixtures/auth';

test.describe.configure({ mode: 'serial' });

const A2_SEAT_ID = '550e8400-e29b-41d4-a716-446655440011';

async function createReservation(request: any, seatId: string) {
  const response = await request.post('/api/reservations', {
    data: { seatIds: [seatId] },
    headers: { Authorization: 'Bearer test_token' },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  return body.reservationId;
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/test/cleanup');
});

test.beforeEach(async ({ page }) => {
  await signInAsTestUser(page);
});

test('checkout review shows expired hold when the seat hold ran out', async ({ page, request }) => {
  const reservationId = await createReservation(request, A2_SEAT_ID);
  await request.post(`/api/test/expire-reservation/${reservationId}`);

  await page.goto(`/checkout/${reservationId}`);

  await expect(page.locator('h1')).toContainText('Checkout unavailable', { timeout: 10000 });
  await expect(page.getByTestId('checkout-error')).toContainText('Your hold has expired');
  await expect(page.getByRole('link', { name: /Back to seat map/i })).toBeVisible();
});

test('paying after the seat was released mid-flow shows an error', async ({ page, request }) => {
  const reservationId = await createReservation(request, A2_SEAT_ID);
  await page.goto(`/checkout/${reservationId}`);
  await expect(page.getByRole('button', { name: /Pay/i })).toBeVisible({ timeout: 10000 });

  // Simulate the seat being taken by another customer while this review page is open.
  await request.post(`/api/test/release-reservation/${reservationId}`);

  await page.getByRole('button', { name: /Pay/i }).click();

  await expect(page.getByTestId('pay-error')).toContainText('This reservation is already paid or no longer held.', { timeout: 10000 });
});

test('cancel page is reachable and shows seat map link', async ({ page }) => {
  await page.goto('/checkout/cancel');
  await expect(page.locator('h1')).toContainText('Payment cancelled');
  await expect(page.getByRole('link', { name: /Change seat/i })).toBeVisible();
});
