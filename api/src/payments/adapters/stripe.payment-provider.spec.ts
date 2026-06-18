import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';

const sessionsCreate = vi.fn();
const constructEvent = vi.fn();
vi.mock('stripe', () => ({
  default: vi.fn(function () {
    return {
      checkout: { sessions: { create: sessionsCreate } },
      webhooks: { constructEvent },
    };
  }),
}));

import { StripePaymentProvider } from './stripe.payment-provider';

const config = {
  get: (k: string) =>
    ({
      STRIPE_SECRET_KEY: 'sk_x',
      STRIPE_WEBHOOK_SECRET: 'whsec_x',
      STRIPE_SUCCESS_URL: 'https://app/success',
      STRIPE_CANCEL_URL: 'https://app/cancel',
    })[k],
} as unknown as import('@nestjs/config').ConfigService;

describe('StripePaymentProvider.createCheckoutSession', () => {
  beforeEach(() => sessionsCreate.mockReset());
  it('creates a one-off session with metadata + idempotency key', async () => {
    sessionsCreate.mockResolvedValue({ id: 'cs_1', url: 'https://stripe/cs_1' });
    const provider = new StripePaymentProvider(config);
    const out = await provider.createCheckoutSession({
      paymentId: 'p1', reservationId: 'r1', amount: 5000, currency: 'usd', idempotencyKey: 'pay_r1',
    });
    expect(out).toEqual({ providerRef: 'cs_1', checkoutUrl: 'https://stripe/cs_1' });
    const [params, opts] = sessionsCreate.mock.calls[0];
    expect(params.mode).toBe('payment');
    expect(params.metadata).toEqual({ paymentId: 'p1', reservationId: 'r1' });
    expect(params.line_items[0].price_data).toMatchObject({ currency: 'usd', unit_amount: 5000 });
    expect(opts).toEqual({ idempotencyKey: 'pay_r1' });
  });
  it('appends reservationId to success_url/cancel_url (? when no query)', async () => {
    sessionsCreate.mockResolvedValue({ id: 'cs_1', url: 'https://stripe/cs_1' });
    const provider = new StripePaymentProvider(config);
    await provider.createCheckoutSession({
      paymentId: 'p1', reservationId: 'r1', amount: 5000, currency: 'usd', idempotencyKey: 'pay_r1',
    });
    const [params] = sessionsCreate.mock.calls[0];
    expect(params.success_url).toBe('https://app/success?reservationId=r1');
    expect(params.cancel_url).toBe('https://app/cancel?reservationId=r1');
  });
  it('appends reservationId with & when the URL already has a query', async () => {
    sessionsCreate.mockResolvedValue({ id: 'cs_1', url: 'https://stripe/cs_1' });
    const configWithQuery = {
      get: (k: string) =>
        ({
          STRIPE_SECRET_KEY: 'sk_x',
          STRIPE_WEBHOOK_SECRET: 'whsec_x',
          STRIPE_SUCCESS_URL: 'https://app/success?session=abc',
          STRIPE_CANCEL_URL: 'https://app/cancel?session=abc',
        })[k],
    } as unknown as import('@nestjs/config').ConfigService;
    const provider = new StripePaymentProvider(configWithQuery);
    await provider.createCheckoutSession({
      paymentId: 'p1', reservationId: 'r1', amount: 5000, currency: 'usd', idempotencyKey: 'pay_r1',
    });
    const [params] = sessionsCreate.mock.calls[0];
    expect(params.success_url).toBe('https://app/success?session=abc&reservationId=r1');
    expect(params.cancel_url).toBe('https://app/cancel?session=abc&reservationId=r1');
  });
  it('throws when Stripe returns no url', async () => {
    sessionsCreate.mockResolvedValue({ id: 'cs_1', url: null });
    const provider = new StripePaymentProvider(config);
    await expect(
      provider.createCheckoutSession({ paymentId: 'p1', reservationId: 'r1', amount: 1, currency: 'usd', idempotencyKey: 'k' }),
    ).rejects.toThrow();
  });
});

describe('StripePaymentProvider.constructEvent', () => {
  beforeEach(() => constructEvent.mockReset());
  it('normalizes a paid checkout.session.completed', () => {
    constructEvent.mockReturnValue({
      id: 'evt_1', type: 'checkout.session.completed',
      data: { object: { metadata: { paymentId: 'p1' }, payment_status: 'paid' } },
    });
    const provider = new StripePaymentProvider(config);
    const e = provider.constructEvent(Buffer.from('{}'), 'sig');
    expect(e).toMatchObject({ id: 'evt_1', type: 'checkout.session.completed', paymentId: 'p1', isPaid: true });
  });
  it('throws BadRequestException on bad signature', () => {
    const provider = new StripePaymentProvider(config);
    // Override with a plain throwing fn (a vi.fn that throws is collected by
    // vitest as an unhandled error even when the SUT catches it).
    const stripe = (provider as unknown as {
      stripe: { webhooks: { constructEvent: () => never } };
    }).stripe;
    stripe.webhooks.constructEvent = () => {
      throw new Error('bad sig');
    };
    expect(() => provider.constructEvent(Buffer.from('{}'), 'sig')).toThrow(BadRequestException);
  });
});
