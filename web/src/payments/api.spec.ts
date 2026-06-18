import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPayment, getPayment, testSucceed } from './api';
import { ApiError } from '../common/api';

const okResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) } as never as Response);

const uuid = '550e8400-e29b-41d4-a716-446655440000';

describe('createPayment', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('POSTs parsed body + Bearer token', async () => {
    const body = { paymentId: 'pay_1', checkoutUrl: 'https://x/checkout' };
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse(body));
    const out = await createPayment(uuid, () => Promise.resolve('t'));
    expect(spy).toHaveBeenCalledWith(
      '/api/payments',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reservationId: uuid }),
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
      }),
    );
    expect(out).toEqual(body);
  });
});

describe('getPayment', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('parses a PaymentResponse and passes the token', async () => {
    const body = { id: 'pay_1', reservationId: uuid, status: 'succeeded', amount: 12400, currency: 'usd' };
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse(body));
    const out = await getPayment(uuid, () => Promise.resolve('t'));
    expect(spy).toHaveBeenCalledWith(
      `/api/payments?reservationId=${uuid}`,
      expect.objectContaining({
        method: 'GET',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
      }),
    );
    expect(out).toEqual(body);
  });

  it('throws ApiError on non-ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve(null),
    } as never as Response);
    await expect(getPayment(uuid, () => Promise.resolve('t'))).rejects.toBeInstanceOf(ApiError);
  });
});

describe('testSucceed', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('POSTs parsed body + token and resolves on ok', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse({}));
    await testSucceed('pay_1', uuid, () => Promise.resolve('t'));
    expect(spy).toHaveBeenCalledWith(
      '/api/payments/test-succeed',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ paymentId: 'pay_1', reservationId: uuid }),
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
      }),
    );
  });

  it('throws ApiError on non-ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve(null),
    } as never as Response);
    await expect(testSucceed('pay_1', uuid, () => Promise.resolve('t'))).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});