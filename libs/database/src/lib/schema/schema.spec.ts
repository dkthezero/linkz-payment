import { describe, it, expect } from 'vitest';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import {
  users,
  seats,
  reservations,
  reservationSeats,
  payments,
  webhookEvents,
  invoices,
  tickets,
} from './index';

// --- introspection helpers (real schema, no mocks) ------------------------
type Cols = Record<
  string,
  { name: string; primary: boolean; notNull: boolean; isUnique: boolean; hasDefault: boolean }
>;

const cols = (t: PgTable): Cols =>
  Object.fromEntries(
    getTableConfig(t).columns.map((c) => [
      c.name,
      { name: c.name, primary: c.primary, notNull: c.notNull, isUnique: c.isUnique, hasDefault: c.hasDefault },
    ]),
  );

// map: local FK column name -> referenced "table.column"
const fks = (t: PgTable): Record<string, string> =>
  Object.fromEntries(
    getTableConfig(t).foreignKeys.map((fk) => {
      const ref = fk.reference();
      return [ref.columns[0].name, `${getTableConfig(ref.foreignTable).name}.${ref.foreignColumns[0].name}`];
    }),
  );

const idx = (t: PgTable) =>
  Object.fromEntries(getTableConfig(t).indexes.map((i) => [i.config.name, i.config]));

describe('users (identity mirror — no password)', () => {
  it('has the ERD columns + name, and no password column', () => {
    const c = cols(users);
    expect(getTableConfig(users).name).toBe('users');
    expect(Object.keys(c).sort()).toEqual(['created_at', 'email', 'external_id', 'id', 'name']);
    expect(c['password']).toBeUndefined();
  });
  it('enforces id PK, unique Clerk subject, required email + name + created_at default', () => {
    const c = cols(users);
    expect(c['id'].primary).toBe(true);
    expect(c['external_id']).toMatchObject({ notNull: true, isUnique: true });
    expect(c['email'].notNull).toBe(true);
    expect(c['name']).toMatchObject({ notNull: true });
    expect(c['created_at']).toMatchObject({ notNull: true, hasDefault: true });
  });
});

describe('seats (3 bookable seats)', () => {
  it('has id PK, unique label, price, created_at default', () => {
    const c = cols(seats);
    expect(getTableConfig(seats).name).toBe('seats');
    expect(Object.keys(c).sort()).toEqual(['created_at', 'id', 'label', 'price']);
    expect(c['id'].primary).toBe(true);
    expect(c['label']).toMatchObject({ notNull: true, isUnique: true });
    expect(c['price']).toMatchObject({ notNull: true, hasDefault: true });
    expect(c['created_at']).toMatchObject({ notNull: true, hasDefault: true });
  });
});

describe('reservations (hold/booking + saga state)', () => {
  it('has the ERD columns with correct nullability + defaults (no direct seat_id)', () => {
    const c = cols(reservations);
    expect(getTableConfig(reservations).name).toBe('reservations');
    expect(Object.keys(c).sort()).toEqual(
      ['created_at', 'hold_expires_at', 'id', 'saga_step', 'status', 'updated_at', 'user_id', 'version'].sort(),
    );
    expect(c['id'].primary).toBe(true);
    expect(c['user_id'].notNull).toBe(true);
    expect(c['status'].notNull).toBe(true);
    expect(c['saga_step'].notNull).toBe(true);
    expect(c['hold_expires_at'].notNull).toBe(false); // nullable TTL
    expect(c['version']).toMatchObject({ notNull: true, hasDefault: true });
    expect(c['created_at']).toMatchObject({ notNull: true, hasDefault: true });
    expect(c['updated_at']).toMatchObject({ notNull: true, hasDefault: true });
    expect(c['seat_id']).toBeUndefined();
  });
  it('references users', () => {
    expect(fks(reservations)).toEqual({ user_id: 'users.id' });
  });
  it('has the sweep index only; concurrency guard moved to reservation_seats', () => {
    const i = idx(reservations);
    expect(i['ix_reservation_sweep'].unique).toBe(false);
    expect(i['uq_active_seat_partial']).toBeUndefined();
  });
});

describe('reservation_seats (join table + concurrency guard)', () => {
  it('has reservation_id, seat_id, status, timestamps', () => {
    const c = cols(reservationSeats);
    expect(getTableConfig(reservationSeats).name).toBe('reservation_seats');
    expect(Object.keys(c).sort()).toEqual(
      ['created_at', 'reservation_id', 'seat_id', 'status', 'updated_at'].sort(),
    );
    expect(c['reservation_id'].notNull).toBe(true);
    expect(c['seat_id'].notNull).toBe(true);
    expect(c['status'].notNull).toBe(true);
  });
  it('references reservations and seats', () => {
    expect(fks(reservationSeats)).toEqual({ reservation_id: 'reservations.id', seat_id: 'seats.id' });
  });
  it('has the partial-unique active-seat guard', () => {
    const i = idx(reservationSeats);
    expect(i['uq_active_seat_partial'].unique).toBe(true);
    expect(i['uq_active_seat_partial'].where).toBeDefined();
  });
});

describe('payments (attempts)', () => {
  it('has the ERD columns with idempotency guard', () => {
    const c = cols(payments);
    expect(getTableConfig(payments).name).toBe('payments');
    expect(Object.keys(c).sort()).toEqual(
      ['amount', 'created_at', 'currency', 'id', 'idempotency_key', 'provider', 'provider_ref', 'reservation_id', 'status', 'updated_at'].sort(),
    );
    expect(c['id'].primary).toBe(true);
    expect(c['idempotency_key']).toMatchObject({ notNull: true, isUnique: true });
    expect(c['provider_ref'].notNull).toBe(false);
    expect(c['amount'].notNull).toBe(true);
    expect(c['status'].notNull).toBe(true);
  });
  it('references reservations', () => {
    expect(fks(payments)).toEqual({ reservation_id: 'reservations.id' });
  });
});

describe('webhook_events (idempotency ledger)', () => {
  it('uses provider event_id as PK and stores jsonb payload', () => {
    const c = cols(webhookEvents);
    expect(getTableConfig(webhookEvents).name).toBe('webhook_events');
    expect(Object.keys(c).sort()).toEqual(['event_id', 'payload', 'processed_at', 'received_at', 'status', 'type'].sort());
    expect(c['event_id'].primary).toBe(true);
    expect(c['payload'].notNull).toBe(true);
    expect(c['received_at']).toMatchObject({ notNull: true, hasDefault: true });
    expect(c['processed_at'].notNull).toBe(false);
  });
});

describe('invoices (idempotent per reservation)', () => {
  it('has unique reservation_id + number', () => {
    const c = cols(invoices);
    expect(getTableConfig(invoices).name).toBe('invoices');
    expect(Object.keys(c).sort()).toEqual(['amount', 'currency', 'id', 'issued_at', 'number', 'pdf_url', 'reservation_id'].sort());
    expect(c['id'].primary).toBe(true);
    expect(c['reservation_id']).toMatchObject({ notNull: true, isUnique: true });
    expect(c['number']).toMatchObject({ notNull: true, isUnique: true });
    expect(c['pdf_url'].notNull).toBe(false);
  });
  it('references reservations', () => {
    expect(fks(invoices)).toEqual({ reservation_id: 'reservations.id' });
  });
});

describe('tickets (one per seat in a reservation)', () => {
  it('has reservation_id + seat_id + serial, no unique reservation_id', () => {
    const c = cols(tickets);
    expect(getTableConfig(tickets).name).toBe('tickets');
    expect(Object.keys(c).sort()).toEqual(['id', 'issued_at', 'qr_code', 'reservation_id', 'seat_id', 'serial'].sort());
    expect(c['id'].primary).toBe(true);
    expect(c['reservation_id']).toMatchObject({ notNull: true, isUnique: false });
    expect(c['seat_id']).toMatchObject({ notNull: true });
    expect(c['serial']).toMatchObject({ notNull: true, isUnique: true });
    expect(c['qr_code'].notNull).toBe(false);
  });
  it('references reservations and seats', () => {
    expect(fks(tickets)).toEqual({ reservation_id: 'reservations.id', seat_id: 'seats.id' });
  });
});
