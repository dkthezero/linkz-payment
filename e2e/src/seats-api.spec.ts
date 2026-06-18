import { test, expect } from '@playwright/test';

test('GET /api/seats returns the 3 bookable seats', async ({ request }) => {
  const res = await request.get('/api/seats');
  expect(res.ok()).toBeTruthy();
  const seats = await res.json();
  expect(seats).toHaveLength(3);
  expect(seats.map((s: { label: string }) => s.label).sort()).toEqual(['A1', 'A2', 'A3']);
  expect(seats).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ label: 'A1', price: 12000, status: 'available' }),
      expect.objectContaining({ label: 'A2', price: 9500, status: 'available' }),
      expect.objectContaining({ label: 'A3', price: 8000, status: 'available' }),
    ]),
  );
});

test('GET /api/seats/:id returns a single seat', async ({ request }) => {
  const list = await request.get('/api/seats');
  const seats = await list.json();
  const a1 = seats.find((s: { label: string }) => s.label === 'A1');
  expect(a1).toBeDefined();

  const res = await request.get(`/api/seats/${a1.id}`);
  expect(res.ok()).toBeTruthy();
  await expect(res.json()).resolves.toEqual(
    expect.objectContaining({ id: a1.id, label: 'A1', price: 12000, status: 'available' }),
  );
});

test('GET /api/seats/:id returns 404 for unknown seat', async ({ request }) => {
  const res = await request.get('/api/seats/550e8400-e29b-41d4-a716-446655440099');
  expect(res.status()).toBe(404);
});
