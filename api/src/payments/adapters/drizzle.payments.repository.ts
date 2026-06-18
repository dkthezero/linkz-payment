import { Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { payments, webhookEvents } from '@linkz/database';
import { DrizzleService } from '../../drizzle/drizzle.service';
import type { PaymentsRepositoryPort, PaymentRow, NewPayment, ProviderEvent } from '../payments.ports';

@Injectable()
export class DrizzlePaymentsRepository implements PaymentsRepositoryPort {
  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  async findById(paymentId: string): Promise<PaymentRow | null> {
    const [row] = await this.db.select().from(payments).where(eq(payments.id, paymentId));
    return row ? this.toRow(row) : null;
  }

  async findByReservation(reservationId: string): Promise<PaymentRow | null> {
    // Latest attempt wins — a reservation may have prior failed/refunded rows
    // plus a newer pending/succeeded one. Ordered by createdAt desc so the
    // poll + "already paid" checks reflect the most recent attempt.
    const [row] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.reservationId, reservationId))
      .orderBy(desc(payments.createdAt));
    return row ? this.toRow(row) : null;
  }

  async insertPending(input: NewPayment): Promise<PaymentRow> {
    const [row] = await this.db
      .insert(payments)
      .values({
        reservationId: input.reservationId,
        provider: input.provider,
        providerRef: input.providerRef,
        idempotencyKey: input.idempotencyKey,
        amount: input.amount,
        currency: input.currency,
        status: input.status,
      })
      .returning();
    return this.toRow(row);
  }

  async updateProviderRef(paymentId: string, providerRef: string): Promise<void> {
    await this.db
      .update(payments)
      .set({ providerRef, updatedAt: new Date() })
      .where(eq(payments.id, paymentId));
  }

  async settle(paymentId: string, outcome: 'succeeded' | 'failed', event: ProviderEvent): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      // Exactly-once: ledger insert + settlement are atomic. Duplicate event -> no-op.
      const led = await tx
        .insert(webhookEvents)
        .values({
          eventId: event.id,
          type: event.type,
          payload: event.raw,
          status: 'processed',
          processedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ eventId: webhookEvents.eventId });
      if (led.length === 0) return false; // already processed

      const [pay] = await tx
        .update(payments)
        .set({ status: outcome, updatedAt: new Date() })
        .where(eq(payments.id, paymentId))
        .returning();
      if (!pay) return false; // unknown payment id

      return true;
    });
  }

  private toRow(row: typeof payments.$inferSelect): PaymentRow {
    return {
      id: row.id,
      reservationId: row.reservationId,
      status: row.status,
      amount: row.amount,
      currency: row.currency,
      idempotencyKey: row.idempotencyKey,
      providerRef: row.providerRef,
    };
  }
}
