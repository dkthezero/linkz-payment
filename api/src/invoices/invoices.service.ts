import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { InvoiceResponse } from '@linkz/shared';
import { RESERVATIONS_REPOSITORY, type ReservationsRepository } from '../reservations/reservations.ports';
import { INVOICES_REPOSITORY, type InvoicesRepository, type NewInvoice } from './invoices.ports';

@Injectable()
export class InvoicesService {
  constructor(
    @Inject(INVOICES_REPOSITORY) private readonly repo: InvoicesRepository,
    @Inject(RESERVATIONS_REPOSITORY) private readonly reservations: ReservationsRepository,
  ) {}

  async issue(reservationId: string, amount: number, currency: string): Promise<InvoiceResponse> {
    const existing = await this.repo.findByReservationId(reservationId);
    if (existing) return toResponse(existing);

    const reservation = await this.reservations.findById(reservationId);
    if (!reservation) throw new NotFoundException(`Reservation ${reservationId} not found`);

    // Dummy data: deterministic invoice number + placeholder PDF URL. The
    // saga really triggers invoice issuance; these values are placeholders so
    // the frontend can render the flow without a real PDF/invoicing backend.
    const number = `INV-DUMMY-${reservationId.slice(0, 8)}`;
    const input: NewInvoice = {
      reservationId,
      number,
      amount,
      currency,
      pdfUrl: `https://dummy.linkz.dev/invoices/${number}`,
    };
    const row = await this.repo.insert(input);
    return toResponse(row);
  }

  async findByReservationId(reservationId: string): Promise<InvoiceResponse> {
    const row = await this.repo.findByReservationId(reservationId);
    if (!row) throw new NotFoundException(`Invoice for reservation ${reservationId} not found`);
    return toResponse(row);
  }
}

function toResponse(row: import('./invoices.ports').InvoiceRow): InvoiceResponse {
  return {
    id: row.id,
    reservationId: row.reservationId,
    number: row.number,
    amount: row.amount,
    currency: row.currency,
    pdfUrl: row.pdfUrl,
  };
}
