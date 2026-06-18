import { describe, it, expect } from 'vitest';
import type { CheckoutReviewResponse } from '@linkz/shared';
import { toPendingRelease } from './departure';

const review: CheckoutReviewResponse = {
  reservation: {
    id: '550e8400-e29b-41d4-a716-446655440002',
    seatIds: ['550e8400-e29b-41d4-a716-446655440010', '550e8400-e29b-41d4-a716-446655440011'],
    status: 'held',
    expiresAt: '2026-06-19T12:02:30.000Z',
  },
  seats: [
    { id: '550e8400-e29b-41d4-a716-446655440010', label: 'A1', descriptor: 'Front row', price: 12000 },
    { id: '550e8400-e29b-41d4-a716-446655440011', label: 'A2', descriptor: 'Front row', price: 9500 },
  ],
  pricing: { seatPrice: 21500, serviceFee: 400, total: 21900, currency: 'usd' },
  contact: { email: 'a@b.com' },
  status: 'held',
};

describe('toPendingRelease', () => {
  it('maps the reservation id and seat ids from a checkout review', () => {
    expect(toPendingRelease(review)).toEqual({
      reservationId: '550e8400-e29b-41d4-a716-446655440002',
      seatIds: ['550e8400-e29b-41d4-a716-446655440010', '550e8400-e29b-41d4-a716-446655440011'],
    });
  });
});