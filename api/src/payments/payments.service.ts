import { Inject, Injectable, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mapEvent } from './payments.domain';
import { ReservationsService } from '../reservations/reservations.service';
import { SagaProcessor } from '../saga/saga.processor';
import { PaymentResponseSchema, type AppUser, type PaymentResponse } from '@linkz/shared';
import {
  PAYMENT_PROVIDER,
  PAYMENTS_REPOSITORY,
  type PaymentProviderPort,
  type PaymentsRepositoryPort,
  type PaymentRow,
} from './payments.ports';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProviderPort,
    @Inject(PAYMENTS_REPOSITORY) private readonly repo: PaymentsRepositoryPort,
    private readonly config: ConfigService,
    private readonly reservations: ReservationsService,
    private readonly saga: SagaProcessor,
  ) {}

  async createPayment(
    reservationId: string,
    appUser: AppUser,
  ): Promise<{ paymentId: string; checkoutUrl: string }> {
    this.logger.debug(`createPayment: reservation=${reservationId} user=${appUser.id}`);
    // Authorization + price in one call: owner-gate, active (non-expired) hold,
    // seat join + pricing. Throws NotFound/Forbidden/Gone/Conflict — propagated
    // as the authorization decision (no separate authorize* stub).
    const review = await this.reservations.getCheckoutReview(reservationId, appUser.id, appUser.email);

    const existing = await this.repo.findByReservation(reservationId);
    if (existing?.status === 'succeeded') {
      throw new ConflictException('Reservation already paid');
    }

    const amount = review.pricing.total;
    const currency = review.pricing.currency;
    const providerName = this.config.get<string>('PAYMENT_PROVIDER') ?? 'stripe';

    let payment: PaymentRow;
    if (existing?.status === 'pending') {
      // Reuse the in-flight pending attempt (idempotent retry of create-payment).
      payment = existing;
    } else {
      // existing is null (first attempt) or failed/refunded (prior attempt).
      // A prior failed row must NOT reuse its Stripe idempotency key (Stripe 409
      // on reuse with different params) — mint a fresh key for a new attempt.
      const idempotencyKey =
        existing === null ? `pay_${reservationId}` : `pay_${reservationId}_${Date.now()}`;
      payment = await this.repo.insertPending({
        reservationId,
        provider: providerName,
        providerRef: null,
        idempotencyKey,
        amount,
        currency,
        status: 'pending',
      });
    }

    const { providerRef, checkoutUrl } = await this.provider.createCheckoutSession({
      paymentId: payment.id,
      reservationId,
      amount: payment.amount,
      currency: payment.currency,
      idempotencyKey: payment.idempotencyKey,
    });

    // Persist the PSP intent id so reconciliation/refund lookup works even
    // before the webhook lands (closes the null-until-webhook gap).
    await this.repo.updateProviderRef(payment.id, providerRef);
    this.logger.debug(`createPayment: session created payment=${payment.id} ref=${providerRef}`);

    return { paymentId: payment.id, checkoutUrl };
  }

  async getPaymentByReservation(reservationId: string, userId: string): Promise<PaymentResponse> {
    this.logger.debug(`getPaymentByReservation: reservation=${reservationId} user=${userId}`);
    // Owner-gate via reservations (throws NotFound/Forbidden if not owned).
    await this.reservations.findById(reservationId, userId);
    const payment = await this.repo.findByReservation(reservationId);
    if (!payment) throw new NotFoundException('Payment not found for reservation');
    return PaymentResponseSchema.parse({
      id: payment.id,
      reservationId: payment.reservationId,
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
    });
  }

  async verifyPayment(reservationId: string, userId: string): Promise<void> {
    await this.reservations.findById(reservationId, userId); // owner-gate
    const payment = await this.repo.findByReservation(reservationId);
    if (!payment || payment.status !== 'pending' || !payment.providerRef) return;
    const event = await this.provider.fetchSessionEvent(payment.providerRef);
    if (!event) return;
    const processed = await this.repo.settle(payment.id, 'succeeded', event);
    if (processed) {
      await this.saga.process(payment.id, 'succeeded');
    }
  }

  async handleWebhook(rawBody: Buffer | string, signature: string): Promise<void> {
    this.logger.debug(`webhook: signature present=${!!signature}`);
    const event = this.provider.constructEvent(rawBody, signature); // throws BadRequest on bad sig
    const outcome = mapEvent(event);
    if (outcome === 'ignore' || !event.paymentId) return;
    const processed = await this.repo.settle(event.paymentId, outcome, event);
    // Only run the saga when settle actually committed a new event — duplicate
    // webhook retries from Stripe hit the idempotency ledger and must not
    // re-run the saga (confirm would throw because the reservation is already
    // confirmed, causing this handler to return 500 → infinite Stripe retry loop).
    if (processed) {
      await this.saga.process(event.paymentId, outcome);
    }
  }
}
