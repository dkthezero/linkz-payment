import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SagaProcessor } from './saga.processor';
import type { PaymentsRepositoryPort, PaymentRow } from '../payments/payments.ports';
import type { ReservationsService } from '../reservations/reservations.service';
import type { InvoicesService } from '../invoices/invoices.service';
import type { TicketsService } from '../tickets/tickets.service';

const payment = (over: Partial<PaymentRow> = {}): PaymentRow => ({
  id: '550e8400-e29b-41d4-a716-446655440000',
  reservationId: '550e8400-e29b-41d4-a716-446655440001',
  status: 'pending',
  amount: 12400,
  currency: 'usd',
  idempotencyKey: 'pay_1',
  providerRef: 'cs_1',
  ...over,
});

const makePayments = (): PaymentsRepositoryPort => ({
  findById: vi.fn().mockResolvedValue(payment()),
  findByReservation: vi.fn(),
  insertPending: vi.fn(),
  updateProviderRef: vi.fn(),
  settle: vi.fn(),
});

const makeReservations = (): Pick<ReservationsService, 'confirm' | 'releaseBySystem'> => ({
  confirm: vi.fn().mockResolvedValue(undefined),
  releaseBySystem: vi.fn().mockResolvedValue(undefined),
});

const makeInvoices = (): Pick<InvoicesService, 'issue'> => ({
  issue: vi.fn().mockResolvedValue({ id: 'i1', reservationId: payment().reservationId, number: 'INV-1', amount: 12400, currency: 'usd', pdfUrl: null }),
});

const makeTickets = (): Pick<TicketsService, 'issue'> => ({
  issue: vi.fn().mockResolvedValue(undefined),
});

describe('SagaProcessor', () => {
  let payments: PaymentsRepositoryPort;
  let reservations: Pick<ReservationsService, 'confirm' | 'releaseBySystem'>;
  let invoices: Pick<InvoicesService, 'issue'>;
  let tickets: Pick<TicketsService, 'issue'>;
  let processor: SagaProcessor;

  beforeEach(() => {
    payments = makePayments();
    reservations = makeReservations();
    invoices = makeInvoices();
    tickets = makeTickets();
    processor = new SagaProcessor(payments, reservations as ReservationsService, invoices as InvoicesService, tickets as TicketsService);
  });

  it('success path: confirms reservation, issues invoice, issues ticket', async () => {
    await processor.process(payment().id, 'succeeded');
    expect(payments.findById).toHaveBeenCalledWith(payment().id);
    expect(reservations.confirm).toHaveBeenCalledWith(payment().reservationId);
    expect(invoices.issue).toHaveBeenCalledWith(payment().reservationId, 12400, 'usd');
    expect(tickets.issue).toHaveBeenCalledWith(payment().reservationId);
  });

  it('failure path: releases the held seat as compensation', async () => {
    await processor.process(payment().id, 'failed');
    expect(payments.findById).toHaveBeenCalledWith(payment().id);
    expect(reservations.releaseBySystem).toHaveBeenCalledWith(payment().reservationId);
    expect(reservations.confirm).not.toHaveBeenCalled();
    expect(invoices.issue).not.toHaveBeenCalled();
    expect(tickets.issue).not.toHaveBeenCalled();
  });

  it('is a no-op when the payment is missing', async () => {
    payments.findById = vi.fn().mockResolvedValue(null);
    await processor.process('missing-id', 'succeeded');
    expect(reservations.confirm).not.toHaveBeenCalled();
    expect(reservations.releaseBySystem).not.toHaveBeenCalled();
  });

  it('still acks the webhook when compensation release throws', async () => {
    reservations.releaseBySystem = vi.fn().mockRejectedValue(new Error('already released'));
    await expect(processor.process(payment().id, 'failed')).resolves.toBeUndefined();
    expect(reservations.releaseBySystem).toHaveBeenCalled();
  });
});
