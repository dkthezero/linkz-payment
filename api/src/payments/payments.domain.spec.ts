import { describe, it, expect } from 'vitest';
import { mapEvent } from './payments.domain';
import type { ProviderEvent } from './payments.ports';

const ev = (over: Partial<ProviderEvent>): ProviderEvent => ({
  id: 'evt_1',
  type: 'checkout.session.completed',
  paymentId: 'p1',
  isPaid: true,
  raw: {},
  ...over,
});

describe('mapEvent', () => {
  it('paid checkout session -> succeeded', () => {
    expect(mapEvent(ev({ type: 'checkout.session.completed', isPaid: true }))).toBe('succeeded');
  });
  it('unpaid checkout session -> ignore', () => {
    expect(mapEvent(ev({ type: 'checkout.session.completed', isPaid: false }))).toBe('ignore');
  });
  it('checkout.session.expired -> failed', () => {
    expect(mapEvent(ev({ type: 'checkout.session.expired', isPaid: false }))).toBe('failed');
  });
  it('checkout.session.async_payment_failed -> failed', () => {
    expect(mapEvent(ev({ type: 'checkout.session.async_payment_failed', isPaid: false }))).toBe('failed');
  });
  it('payment_intent.payment_failed -> failed', () => {
    expect(mapEvent(ev({ type: 'payment_intent.payment_failed', isPaid: false }))).toBe('failed');
  });
  it('test.checkout.session.completed (paid) -> succeeded', () => {
    expect(mapEvent(ev({ type: 'test.checkout.session.completed', isPaid: true }))).toBe('succeeded');
  });
  it('unknown type -> ignore', () => {
    expect(mapEvent(ev({ type: 'invoice.created' }))).toBe('ignore');
  });
});