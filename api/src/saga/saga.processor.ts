import { Inject, Injectable, Logger } from '@nestjs/common';
import { InvoicesService } from '../invoices/invoices.service';
import { PAYMENTS_REPOSITORY, type PaymentsRepositoryPort } from '../payments/payments.ports';
import { ReservationsService } from '../reservations/reservations.service';
import { TicketsService } from '../tickets/tickets.service';

/**
 * Synchronous, in-process saga processor.
 *
 * Runs immediately after `settle()` returns true inside the same webhook
 * handler — no message queue or background worker required.
 *
 * Success path (forward-recovery, payment already captured):
 *   payment.succeeded -> confirm reservation -> issue invoice -> issue ticket
 *
 * Failure path (compensation, before capture):
 *   payment.failed -> release the held seat
 */
@Injectable()
export class SagaProcessor {
  private readonly logger = new Logger(SagaProcessor.name);

  constructor(
    @Inject(PAYMENTS_REPOSITORY) private readonly payments: PaymentsRepositoryPort,
    private readonly reservations: ReservationsService,
    private readonly invoices: InvoicesService,
    private readonly tickets: TicketsService,
  ) {}

  async process(paymentId: string, outcome: 'succeeded' | 'failed'): Promise<void> {
    const payment = await this.payments.findById(paymentId);
    if (!payment) {
      this.logger.warn(`Saga cannot run: payment ${paymentId} not found`);
      return;
    }

    const { reservationId } = payment;

    if (outcome === 'succeeded') {
      await this.reservations.confirm(reservationId);
      await this.invoices.issue(reservationId, payment.amount, payment.currency);
      await this.tickets.issue(reservationId);
      this.logger.log(`Saga completed for reservation ${reservationId}`);
      return;
    }

    // outcome === 'failed' — compensate by releasing the held seat.
    try {
      await this.reservations.releaseBySystem(reservationId);
      this.logger.log(`Compensated reservation ${reservationId} after payment failure`);
    } catch (e) {
      // The seat may already be released/expired/confirmed; log and continue
      // so the webhook still acks. A real worker would retry/alert.
      this.logger.warn(`Compensation release failed for ${reservationId}: ${String(e)}`);
    }
  }
}
