import { describe, it, expect } from 'vitest';
import {
  HealthResponseSchema,
  MeResponseSchema,
  AppUserSchema,
  CreatePaymentRequestSchema,
  CreatePaymentResponseSchema,
  SeatStatusSchema,
  SeatResponseSchema,
  SeatListResponseSchema,
  CreateReservationRequestSchema,
  CreateReservationResponseSchema,
  ReservationResponseSchema,
  TicketResponseSchema,
  PaymentSuccessRequestSchema,
  HoldSeatRequestSchema,
  ReservationStatusSchema,
  CheckoutReviewResponseSchema,
  PaymentStatusSchema,
  PaymentResponseSchema,
} from './shared.js';

describe('HealthResponseSchema', () => {
  it('parses ok', () =>
    expect(HealthResponseSchema.parse({ status: 'ok' })).toEqual({ status: 'ok' }));
  it('rejects other', () => expect(() => HealthResponseSchema.parse({ status: 'bad' })).toThrow());
});

describe('MeResponseSchema', () => {
  const valid = { appUserId: '550e8400-e29b-41d4-a716-446655440000', clerkUserId: 'user_1', email: 'a@b.com', name: 'Alice' };
  it('parses appUserId + clerkUserId + email + name', () => expect(MeResponseSchema.parse(valid)).toEqual(valid));
  it('rejects the old shape (clerkUserId only)', () =>
    expect(() => MeResponseSchema.parse({ clerkUserId: 'user_1' })).toThrow());
  it('rejects missing fields', () =>
    expect(() => MeResponseSchema.parse({ appUserId: valid.appUserId, clerkUserId: 'user_1' })).toThrow());
});

describe('AppUserSchema', () => {
  const valid = { id: '550e8400-e29b-41d4-a716-446655440000', externalId: 'user_1', email: 'a@b.com', name: 'Alice' };
  it('parses a valid app user', () => expect(AppUserSchema.parse(valid)).toEqual(valid));
  it('rejects a non-uuid id', () => expect(() => AppUserSchema.parse({ ...valid, id: 'not-a-uuid' })).toThrow());
  it('rejects missing name', () =>
    expect(() => AppUserSchema.parse({ id: valid.id, externalId: 'user_1', email: 'a@b.com' })).toThrow());
});

describe('CreatePaymentRequestSchema', () => {
  it('accepts a uuid reservationId', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    expect(CreatePaymentRequestSchema.parse({ reservationId: id })).toEqual({ reservationId: id });
  });
  it('rejects a non-uuid reservationId', () => {
    expect(() => CreatePaymentRequestSchema.parse({ reservationId: 'nope' })).toThrow();
  });
});

describe('CreatePaymentResponseSchema', () => {
  it('parses a payment id + checkout url', () => {
    const out = CreatePaymentResponseSchema.parse({ paymentId: 'p1', checkoutUrl: 'https://stripe/cs_test' });
    expect(out).toEqual({ paymentId: 'p1', checkoutUrl: 'https://stripe/cs_test' });
  });
  it('rejects an empty checkoutUrl', () => {
    expect(() => CreatePaymentResponseSchema.parse({ paymentId: 'p1', checkoutUrl: '' })).toThrow();
  });
});

describe('SeatStatusSchema', () => {
  it('accepts available and held', () => {
    expect(SeatStatusSchema.parse('available')).toBe('available');
    expect(SeatStatusSchema.parse('held')).toBe('held');
  });
  it('rejects other strings', () => {
    expect(() => SeatStatusSchema.parse('selected')).toThrow();
  });
});

describe('SeatResponseSchema', () => {
  const valid = {
    id: '550e8400-e29b-41d4-a716-446655440010',
    label: 'A1',
    price: 12000,
    status: 'available',
  } as const;
  it('parses a valid seat', () => expect(SeatResponseSchema.parse(valid)).toEqual(valid));
  it('rejects a non-uuid id', () => expect(() => SeatResponseSchema.parse({ ...valid, id: 'nope' })).toThrow());
  it('rejects a negative price', () => expect(() => SeatResponseSchema.parse({ ...valid, price: -1 })).toThrow());
  it('rejects an invalid status', () => expect(() => SeatResponseSchema.parse({ ...valid, status: 'selected' })).toThrow());
});

describe('SeatListResponseSchema', () => {
  it('parses an array of seats', () => {
    const list = [
      { id: '550e8400-e29b-41d4-a716-446655440010', label: 'A1', price: 12000, status: 'available' },
      { id: '550e8400-e29b-41d4-a716-446655440011', label: 'A2', price: 9500, status: 'held' },
    ];
    expect(SeatListResponseSchema.parse(list)).toEqual(list);
  });
});

describe('CreateReservationRequestSchema', () => {
  it('accepts a non-empty array of seat uuids', () => {
    const ids = ['550e8400-e29b-41d4-a716-446655440010', '550e8400-e29b-41d4-a716-446655440011'];
    expect(CreateReservationRequestSchema.parse({ seatIds: ids })).toEqual({ seatIds: ids });
  });
  it('rejects an empty seat list', () => {
    expect(() => CreateReservationRequestSchema.parse({ seatIds: [] })).toThrow();
  });
  it('rejects a non-uuid seatId', () => {
    expect(() => CreateReservationRequestSchema.parse({ seatIds: ['nope'] })).toThrow();
  });
});

describe('CreateReservationResponseSchema', () => {
  it('parses a reservation id', () => {
    const id = '550e8400-e29b-41d4-a716-446655440010';
    expect(CreateReservationResponseSchema.parse({ reservationId: id })).toEqual({ reservationId: id });
  });
});

describe('ReservationResponseSchema', () => {
  it('parses a held reservation with multiple seats', () => {
    const valid = {
      id: '550e8400-e29b-41d4-a716-446655440010',
      seatIds: ['550e8400-e29b-41d4-a716-446655440011', '550e8400-e29b-41d4-a716-446655440012'],
      status: 'held',
      expiresAt: '2026-06-19T12:00:00Z',
    };
    expect(ReservationResponseSchema.parse(valid)).toEqual(valid);
  });
  it('rejects an invalid status', () => {
    expect(() =>
      ReservationResponseSchema.parse({
        id: '550e8400-e29b-41d4-a716-446655440010',
        seatIds: ['550e8400-e29b-41d4-a716-446655440011'],
        status: 'pending',
        expiresAt: null,
      }),
    ).toThrow();
  });
});

describe('TicketResponseSchema', () => {
  it('parses a valid ticket', () => {
    const valid = {
      id: '550e8400-e29b-41d4-a716-446655440010',
      reservationId: '550e8400-e29b-41d4-a716-446655440011',
      seatId: '550e8400-e29b-41d4-a716-446655440012',
      serial: 'T-0001',
      qrCode: null,
    };
    expect(TicketResponseSchema.parse(valid)).toEqual(valid);
  });
});

describe('PaymentSuccessRequestSchema', () => {
  it('accepts paymentId + reservationId', () => {
    const valid = {
      paymentId: 'pay_123',
      reservationId: '550e8400-e29b-41d4-a716-446655440010',
    };
    expect(PaymentSuccessRequestSchema.parse(valid)).toEqual(valid);
  });
});

describe('checkout schemas', () => {
  it('parses a hold request', () => {
    const r = HoldSeatRequestSchema.parse({ seatIds: ['550e8400-e29b-41d4-a716-446655440000'] });
    expect(r.seatIds[0]).toBe('550e8400-e29b-41d4-a716-446655440000');
  });
  it('rejects non-uuid seatId', () => {
    expect(() => HoldSeatRequestSchema.parse({ seatIds: ['nope'] })).toThrow();
  });
  it('reservation status enum', () => {
    expect(ReservationStatusSchema.parse('held')).toBe('held');
    expect(() => ReservationStatusSchema.parse('available')).toThrow(); // not persisted
  });
  it('seat status now includes confirmed', () => {
    expect(SeatStatusSchema.parse('confirmed')).toBe('confirmed');
  });
  it('parses a checkout review', () => {
    const r = CheckoutReviewResponseSchema.parse({
      reservation: { id: '550e8400-e29b-41d4-a716-446655440000', seatIds: ['660e8400-e29b-41d4-a716-446655440000'], status: 'held', expiresAt: new Date().toISOString() },
      seats: [{ id: '660e8400-e29b-41d4-a716-446655440000', label: 'A4', descriptor: 'Front row, center', price: 12000 }],
      pricing: { seatPrice: 12000, serviceFee: 400, total: 12400, currency: 'usd' },
      contact: { email: 'a@b.com' },
      status: 'held',
    });
    expect(r.pricing.total).toBe(12400);
    expect(r.status).toBe('held');
  });
  it('parses a payment response', () => {
    const r = PaymentResponseSchema.parse({ id: 'p1', reservationId: '550e8400-e29b-41d4-a716-446655440000', status: 'succeeded', amount: 12400, currency: 'usd' });
    expect(r.status).toBe('succeeded');
  });
  it('payment status enum', () => {
    expect(PaymentStatusSchema.parse('pending')).toBe('pending');
    expect(() => PaymentStatusSchema.parse('queued')).toThrow();
  });
});
