import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { TestPaymentsController } from './test-payments.controller';
import type { PaymentsService } from './payments.service';
import type { AppUser } from '@linkz/shared';

const appUser: AppUser = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  externalId: 'user_1',
  email: 'a@b.com',
  name: 'Alice',
};

const svc = (over: Partial<PaymentsService> = {}): PaymentsService =>
  ({
    createPayment: vi.fn(),
    getPaymentByReservation: vi.fn(),
    handleWebhook: vi.fn(),
    ...over,
  }) as unknown as PaymentsService;

describe('PaymentsController.create', () => {
  it('delegates to the service with reservationId + resolved appUser', async () => {
    const service = svc({ createPayment: vi.fn().mockResolvedValue({ paymentId: 'p1', checkoutUrl: 'u' }) });
    const ctrl = new PaymentsController(service);
    const out = await ctrl.create({ reservationId: 'r1' }, { appUser } as never);
    expect(service.createPayment).toHaveBeenCalledWith('r1', appUser);
    expect(out).toEqual({ paymentId: 'p1', checkoutUrl: 'u' });
  });

  it('throws when appUser is not resolved', async () => {
    const ctrl = new PaymentsController(svc());
    await expect(ctrl.create({ reservationId: 'r1' }, {} as never)).rejects.toThrow();
  });
});

describe('PaymentsController.poll', () => {
  it('calls getPaymentByReservation with the query reservationId + appUser.id', async () => {
    const service = svc({
      getPaymentByReservation: vi.fn().mockResolvedValue({
        id: 'p1',
        reservationId: 'r1',
        status: 'pending',
        amount: 12400,
        currency: 'usd',
      }),
    });
    const ctrl = new PaymentsController(service);
    const out = await ctrl.poll({ reservationId: '550e8400-e29b-41d4-a716-446655440002' }, { appUser } as never);
    expect(service.getPaymentByReservation).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440002', appUser.id);
    expect(out).toMatchObject({ id: 'p1', reservationId: 'r1', status: 'pending' });
  });

  it('propagates NotFound when no payment exists', async () => {
    const service = svc({
      getPaymentByReservation: vi.fn().mockRejectedValue(new NotFoundException('Payment not found for reservation')),
    });
    const ctrl = new PaymentsController(service);
    await expect(
      ctrl.poll({ reservationId: '550e8400-e29b-41d4-a716-446655440002' }, { appUser } as never),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('PaymentsController.webhook', () => {
  it('passes raw body + signature to the service and acks', async () => {
    const service = svc({ handleWebhook: vi.fn().mockResolvedValue(undefined) });
    const ctrl = new PaymentsController(service);
    const out = await ctrl.webhook({ rawBody: Buffer.from('{}') } as never, 'sig');
    expect(service.handleWebhook).toHaveBeenCalledWith(Buffer.from('{}'), 'sig');
    expect(out).toEqual({ received: true });
  });
  it('rejects when the raw body is missing', async () => {
    const ctrl = new PaymentsController(svc());
    await expect(ctrl.webhook({} as never, 'sig')).rejects.toThrow(BadRequestException);
  });
});

describe('TestPaymentsController', () => {
  it('drives handleWebhook with the known test signature', async () => {
    const service = svc({ handleWebhook: vi.fn().mockResolvedValue(undefined) });
    const ctrl = new TestPaymentsController(service);
    const out = await ctrl.testSucceed({ paymentId: 'p1', reservationId: '550e8400-e29b-41d4-a716-446655440002' });
    expect(service.handleWebhook).toHaveBeenCalled();
    const [body, signature] = (service.handleWebhook as ReturnType<typeof vi.fn>).mock.calls[0] as [Buffer, string];
    expect(signature).toBe('test-signature');
    const parsed = JSON.parse(body.toString('utf-8')) as { type: string; paymentId: string; isPaid: boolean };
    expect(parsed.type).toBe('test.checkout.session.completed');
    expect(parsed.isPaid).toBe(true);
    expect(out).toEqual({ received: true });
  });
});