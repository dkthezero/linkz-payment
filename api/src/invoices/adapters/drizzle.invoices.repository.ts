import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { invoices } from '@linkz/database';
import { DrizzleService } from '../../drizzle/drizzle.service';
import type { InvoicesRepository, InvoiceRow, NewInvoice } from '../invoices.ports';

@Injectable()
export class DrizzleInvoicesRepository implements InvoicesRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  async insert(input: NewInvoice): Promise<InvoiceRow> {
    const [row] = await this.db
      .insert(invoices)
      .values({
        reservationId: input.reservationId,
        number: input.number,
        amount: input.amount,
        currency: input.currency,
        pdfUrl: input.pdfUrl,
      })
      .returning();
    return toRow(row);
  }

  async findByReservationId(reservationId: string): Promise<InvoiceRow | null> {
    const [row] = await this.db.select().from(invoices).where(eq(invoices.reservationId, reservationId));
    return row ? toRow(row) : null;
  }
}

function toRow(row: typeof invoices.$inferSelect): InvoiceRow {
  return {
    id: row.id,
    reservationId: row.reservationId,
    number: row.number,
    amount: row.amount,
    currency: row.currency,
    pdfUrl: row.pdfUrl,
    issuedAt: row.issuedAt,
  };
}
