import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, ForbiddenException, GoneException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import type { ReservationsService } from '../reservations/reservations.service';
import type { SagaProcessor } from '../saga/saga.processor';
import type { AppUser, CheckoutReviewResponse } from '@linkz/shared';
import type { PaymentProviderPort, PaymentsRepositoryPort, PaymentRow, ProviderEvent } from './payments.ports';

const appUser: AppUser = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  externalId: 'user_1',
  email: 'a@b.com',
  name: 'Alice',
};

const review = (over: Partial<CheckoutReviewResponse['pricing']> = {}): CheckoutReviewResponse => ({
  reservation: {
    id: 'r1',
    seatIds: ['s1'],
    status: 'held',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  },
  seats: [{ id: 's1', label: 'A1', descriptor: 'Front row', price: 12000 }],
  pricing: { seatPrice: 12000, serviceFee: 400, total: 12400, currency: 'usd', ...over },
  contact: { email: appUser.email },
  status: 'held',
});

const pending = (over: Partial<PaymentRow> = {}): PaymentRow => ({
  id: 'p1',
  reservationId: 'r1',
  status: 'pending',
  amount: 12400,
  currency: 'usd',
  idempotencyKey: 'pay_r1',
  providerRef: null,
  ...over,
});

const makeProvider = (): PaymentProviderPort => ({
  createCheckoutSession: vi.fn().mockResolvedValue({ providerRef: 'cs_1', checkoutUrl: 'https://stripe/cs_1' }),
  constructEvent: vi.fn(),
  fetchSessionEvent: vi.fn().mockResolvedValue(null),
});

const makeRepo = (): PaymentsRepositoryPort => ({
  findById: vi.fn().mockResolvedValue(null),
  findByReservation: vi.fn().mockResolvedValue(null),
  insertPending: vi.fn().mockResolvedValue(pending()),
  updateProviderRef: vi.fn().mockResolvedValue(undefined),
  settle: vi.fn().mockResolvedValue(true),
});

const makeConfig = (provider = 'stripe'): ConfigService => ({ get: vi.fn((key: string) => (key === 'PAYMENT_PROVIDER' ? provider : undefined)) }) as unknown as ConfigService;

const makeReservations = (
  reviewOver: Partial<CheckoutReviewResponse['pricing']> = {},
): Pick<ReservationsService, 'getCheckoutReview' | 'findById' | 'confirm'> => ({
  getCheckoutReview: vi.fn().mockResolvedValue(review(reviewOver)),
  findById: vi.fn().mockResolvedValue({ id: 'r1' }),
  confirm: vi.fn().mockResolvedValue(undefined),
});

const makeSaga = (): Pick<SagaProcessor, 'process'> => ({
  process: vi.fn().mockResolvedValue(undefined),
});

describe('PaymentsService.createPayment', () => {
  let provider: PaymentProviderPort,
    repo: PaymentsRepositoryPort,
    reservations: Pick<ReservationsService, 'getCheckoutReview' | 'findById' | 'confirm'>,
    saga: Pick<SagaProcessor, 'process'>,
    svc: PaymentsService;

  beforeEach(() => {
    provider = makeProvider();
    repo = makeRepo();
    reservations = makeReservations();
    saga = makeSaga();
    svc = new PaymentsService(provider, repo, makeConfig(), reservations as ReservationsService, saga as SagaProcessor);
  });

  it('inserts a pending payment with seat+fee pricing, persists providerRef, returns the checkout url', async () => {
    const out = await svc.createPayment('r1', appUser);
    expect(reservations.getCheckoutReview).toHaveBeenCalledWith('r1', appUser.id, appUser.email);
    expect(repo.insertPending).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: 'r1',
        provider: 'stripe',
        amount: 12400,
        currency: 'usd',
        idempotencyKey: 'pay_r1',
        status: 'pending',
      }),
    );
    expect(provider.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: 'p1', reservationId: 'r1', idempotencyKey: 'pay_r1' }),
    );
    expect(repo.updateProviderRef).toHaveBeenCalledWith('p1', 'cs_1');
    expect(out).toEqual({ paymentId: 'p1', checkoutUrl: 'https://stripe/cs_1' });
  });

  it('throws Forbidden when the reservation is not owned (no insert, no session)', async () => {
    reservations.getCheckoutReview = vi.fn().mockRejectedValue(new ForbiddenException('Not allowed'));
    await expect(svc.createPayment('r1', appUser)).rejects.toThrow(ForbiddenException);
    expect(repo.insertPending).not.toHaveBeenCalled();
    expect(provider.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('propagates Gone when the hold is expired', async () => {
    reservations.getCheckoutReview = vi.fn().mockRejectedValue(new GoneException('Hold expired'));
    await expect(svc.createPayment('r1', appUser)).rejects.toThrow(GoneException);
  });

  it('propagates Conflict when the reservation is not held (confirmed)', async () => {
    reservations.getCheckoutReview = vi.fn().mockRejectedValue(new ConflictException('Reservation is not held'));
    await expect(svc.createPayment('r1', appUser)).rejects.toThrow(ConflictException);
  });

  it('throws Conflict when an existing payment is already succeeded', async () => {
    repo.findByReservation = vi.fn().mockResolvedValue(pending({ status: 'succeeded' }));
    await expect(svc.createPayment('r1', appUser)).rejects.toThrow('Reservation already paid');
  });

  it('reuses an existing pending payment (no duplicate insert) and updates providerRef', async () => {
    repo.findByReservation = vi.fn().mockResolvedValue(pending({ id: 'p9', idempotencyKey: 'pay_r1' }));
    const out = await svc.createPayment('r1', appUser);
    expect(repo.insertPending).not.toHaveBeenCalled();
    expect(provider.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: 'p9', idempotencyKey: 'pay_r1' }),
    );
    expect(repo.updateProviderRef).toHaveBeenCalledWith('p9', 'cs_1');
    expect(out.paymentId).toBe('p9');
  });

  it('inserts a fresh row with a NEW idempotency key when the prior payment failed', async () => {
    repo.findByReservation = vi.fn().mockResolvedValue(pending({ status: 'failed', idempotencyKey: 'pay_r1' }));
    repo.insertPending = vi.fn().mockResolvedValue(pending({ id: 'p2', idempotencyKey: 'pay_r1_999' }));
    await svc.createPayment('r1', appUser);
    expect(repo.insertPending).toHaveBeenCalledTimes(1);
    const arg = (repo.insertPending as ReturnType<typeof vi.fn>).mock.calls[0][0] as PaymentRow;
    expect(arg.idempotencyKey).not.toBe('pay_r1');
    expect(arg.idempotencyKey).toMatch(/^pay_r1_\d+$/);
    expect(arg.status).toBe('pending');
  });

  it('records the configured payment provider name on the row', async () => {
    svc = new PaymentsService(provider, repo, makeConfig('test'), reservations as ReservationsService, saga as SagaProcessor);
    await svc.createPayment('r1', appUser);
    expect(repo.insertPending).toHaveBeenCalledWith(expect.objectContaining({ provider: 'test' }));
  });
});

describe('PaymentsService.getPaymentByReservation', () => {
  let provider: PaymentProviderPort,
    repo: PaymentsRepositoryPort,
    reservations: Pick<ReservationsService, 'getCheckoutReview' | 'findById' | 'confirm'>,
    saga: Pick<SagaProcessor, 'process'>,
    svc: PaymentsService;

  beforeEach(() => {
    provider = makeProvider();
    repo = makeRepo();
    reservations = makeReservations();
    saga = makeSaga();
    svc = new PaymentsService(provider, repo, makeConfig(), reservations as ReservationsService, saga as SagaProcessor);
  });

  it('returns the PaymentResponse for an owned reservation with a payment', async () => {
    const reservationUuid = '550e8400-e29b-41d4-a716-446655440010';
    repo.findByReservation = vi.fn().mockResolvedValue(
      pending({ id: 'p7', status: 'pending', reservationId: reservationUuid }),
    );
    const out = await svc.getPaymentByReservation(reservationUuid, appUser.id);
    expect(reservations.findById).toHaveBeenCalledWith(reservationUuid, appUser.id);
    expect(out).toMatchObject({
      id: 'p7',
      reservationId: reservationUuid,
      status: 'pending',
      amount: 12400,
      currency: 'usd',
    });
  });

  it('throws NotFound when the reservation is owned but has no payment', async () => {
    repo.findByReservation = vi.fn().mockResolvedValue(null);
    await expect(svc.getPaymentByReservation('r1', appUser.id)).rejects.toThrow(NotFoundException);
  });

  it('propagates Forbidden when the reservation is not owned', async () => {
    reservations.findById = vi.fn().mockRejectedValue(new ForbiddenException('Not allowed'));
    await expect(svc.getPaymentByReservation('r1', appUser.id)).rejects.toThrow(ForbiddenException);
    expect(repo.findByReservation).not.toHaveBeenCalled();
  });
});

describe('PaymentsService.handleWebhook', () => {
  let provider: PaymentProviderPort,
    repo: PaymentsRepositoryPort,
    reservations: Pick<ReservationsService, 'getCheckoutReview' | 'findById' | 'confirm'>,
    saga: Pick<SagaProcessor, 'process'>,
    svc: PaymentsService;
  const event = (over: Partial<ProviderEvent>): ProviderEvent => ({
    id: 'evt_1',
    type: 'checkout.session.completed',
    paymentId: 'p1',
    isPaid: true,
    raw: {},
    ...over,
  });
  beforeEach(() => {
    provider = makeProvider();
    repo = makeRepo();
    reservations = makeReservations();
    saga = makeSaga();
    svc = new PaymentsService(provider, repo, makeConfig(), reservations as ReservationsService, saga as SagaProcessor);
  });

  it('settles succeeded and delegates to the saga processor', async () => {
    provider.constructEvent = vi.fn().mockReturnValue(event({}));
    repo.findById = vi.fn().mockResolvedValue(pending({ reservationId: 'r1' }));
    await svc.handleWebhook(Buffer.from('{}'), 'sig');
    expect(repo.settle).toHaveBeenCalledWith('p1', 'succeeded', expect.objectContaining({ id: 'evt_1' }));
    expect(saga.process).toHaveBeenCalledWith('p1', 'succeeded');
  });

  it('settles failed on payment_intent.payment_failed and delegates to the saga processor', async () => {
    provider.constructEvent = vi.fn().mockReturnValue(event({ type: 'payment_intent.payment_failed', isPaid: false }));
    await svc.handleWebhook(Buffer.from('{}'), 'sig');
    expect(repo.settle).toHaveBeenCalledWith('p1', 'failed', expect.anything());
    expect(saga.process).toHaveBeenCalledWith('p1', 'failed');
  });

  it('settles failed on checkout.session.expired and delegates to the saga processor', async () => {
    provider.constructEvent = vi.fn().mockReturnValue(event({ type: 'checkout.session.expired', isPaid: false }));
    await svc.handleWebhook(Buffer.from('{}'), 'sig');
    expect(repo.settle).toHaveBeenCalledWith('p1', 'failed', expect.anything());
    expect(saga.process).toHaveBeenCalledWith('p1', 'failed');
  });

  it('ignores unrelated events (no settle)', async () => {
    provider.constructEvent = vi.fn().mockReturnValue(event({ type: 'invoice.created', isPaid: false }));
    await svc.handleWebhook(Buffer.from('{}'), 'sig');
    expect(repo.settle).not.toHaveBeenCalled();
  });

  it('does not settle when the event has no paymentId', async () => {
    provider.constructEvent = vi.fn().mockReturnValue(event({ paymentId: null }));
    await svc.handleWebhook(Buffer.from('{}'), 'sig');
    expect(repo.settle).not.toHaveBeenCalled();
  });

  it('skips the saga when settle returns false (duplicate event idempotency)', async () => {
    provider.constructEvent = vi.fn().mockReturnValue(event({}));
    repo.settle = vi.fn().mockResolvedValue(false);
    await svc.handleWebhook(Buffer.from('{}'), 'sig');
    expect(repo.settle).toHaveBeenCalled();
    expect(saga.process).not.toHaveBeenCalled();
  });

  it('propagates signature errors from the provider', async () => {
    // plain throwing fn (a vi.fn that throws is collected by vitest as an unhandled error)
    provider.constructEvent = () => {
      throw new Error('bad sig');
    };
    await expect(svc.handleWebhook(Buffer.from('{}'), 'sig')).rejects.toThrow('bad sig');
  });
});

describe('PaymentsService.verifyPayment', () => {
  const pendingWithRef = (): PaymentRow => ({ id: 'p1', reservationId: 'r1', status: 'pending', amount: 12400, currency: 'usd', idempotencyKey: 'k', providerRef: 'cs_1' });
  const paidEvent = (): ProviderEvent => ({ id: 'verify_cs_1', type: 'checkout.session.completed', paymentId: 'p1', isPaid: true, raw: {} });

  let provider: PaymentProviderPort, repo: PaymentsRepositoryPort, reservations: Pick<ReservationsService, 'getCheckoutReview' | 'findById' | 'confirm'>, saga: Pick<SagaProcessor, 'process'>, svc: PaymentsService;

  beforeEach(() => {
    provider = makeProvider();
    repo = makeRepo();
    reservations = makeReservations();
    saga = makeSaga();
    svc = new PaymentsService(provider, repo, makeConfig(), reservations as ReservationsService, saga as SagaProcessor);
  });

  it('fetches the session and runs the saga when the session is paid', async () => {
    repo.findByReservation = vi.fn().mockResolvedValue(pendingWithRef());
    provider.fetchSessionEvent = vi.fn().mockResolvedValue(paidEvent());
    await svc.verifyPayment('r1', appUser.id);
    expect(provider.fetchSessionEvent).toHaveBeenCalledWith('cs_1');
    expect(repo.settle).toHaveBeenCalledWith('p1', 'succeeded', paidEvent());
    expect(saga.process).toHaveBeenCalledWith('p1', 'succeeded');
  });

  it('does nothing when the session is not yet paid', async () => {
    repo.findByReservation = vi.fn().mockResolvedValue(pendingWithRef());
    provider.fetchSessionEvent = vi.fn().mockResolvedValue(null);
    await svc.verifyPayment('r1', appUser.id);
    expect(repo.settle).not.toHaveBeenCalled();
    expect(saga.process).not.toHaveBeenCalled();
  });

  it('does nothing when the payment is already succeeded', async () => {
    repo.findByReservation = vi.fn().mockResolvedValue({ ...pendingWithRef(), status: 'succeeded' });
    await svc.verifyPayment('r1', appUser.id);
    expect(provider.fetchSessionEvent).not.toHaveBeenCalled();
  });

  it('does nothing when there is no providerRef yet', async () => {
    repo.findByReservation = vi.fn().mockResolvedValue({ ...pendingWithRef(), providerRef: null });
    await svc.verifyPayment('r1', appUser.id);
    expect(provider.fetchSessionEvent).not.toHaveBeenCalled();
  });
});
