import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import type { ReservationsRepository, ReservationRow } from '../reservations/reservations.ports';
import type { InvoicesRepository, InvoiceRow, NewInvoice } from './invoices.ports';

const reservation: ReservationRow = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  seatId: '550e8400-e29b-41d4-a716-446655440010',
  userId: '550e8400-e29b-41d4-a716-446655440002',
  status: 'confirmed',
  sagaStep: 'confirmed',
  holdExpiresAt: null,
  version: 1,
  createdAt: new Date(),
};

const invoiceRow = (over: Partial<InvoiceRow> = {}): InvoiceRow => ({
  id: '550e8400-e29b-41d4-a716-446655440003',
  reservationId: reservation.id,
  number: 'INV-abc',
  amount: 12400,
  currency: 'usd',
  pdfUrl: null,
  issuedAt: new Date(),
  ...over,
});

const makeReservations = (): ReservationsRepository => ({
  insert: vi.fn(),
  findById: vi.fn().mockResolvedValue(reservation),
  findWithSeat: vi.fn(),
  listByUser: vi.fn(),
  confirm: vi.fn(),
  release: vi.fn(),
});

const makeRepo = (): InvoicesRepository => ({
  insert: vi.fn().mockImplementation((input: NewInvoice) =>
    Promise.resolve(invoiceRow({ reservationId: input.reservationId, number: input.number, amount: input.amount, currency: input.currency })),
  ),
  findByReservationId: vi.fn().mockResolvedValue(null),
});

describe('InvoicesService', () => {
  let reservations: ReservationsRepository;
  let repo: InvoicesRepository;
  let svc: InvoicesService;

  beforeEach(() => {
    reservations = makeReservations();
    repo = makeRepo();
    svc = new InvoicesService(repo, reservations);
  });

  it('issues an invoice for a reservation', async () => {
    const out = await svc.issue(reservation.id, 12400, 'usd');
    expect(reservations.findById).toHaveBeenCalledWith(reservation.id);
    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ reservationId: reservation.id, amount: 12400, currency: 'usd', pdfUrl: expect.any(String) }),
    );
    expect(out.reservationId).toBe(reservation.id);
    expect(out.number).toMatch(/^INV-DUMMY-/);
    expect(out.amount).toBe(12400);
    expect(out.currency).toBe('usd');
  });

  it('is idempotent: returns existing invoice without inserting', async () => {
    repo.findByReservationId = vi.fn().mockResolvedValue(invoiceRow());
    const out = await svc.issue(reservation.id, 12400, 'usd');
    expect(reservations.findById).not.toHaveBeenCalled();
    expect(repo.insert).not.toHaveBeenCalled();
    expect(out.id).toBe(invoiceRow().id);
  });

  it('throws NotFound when issuing for a missing reservation', async () => {
    reservations.findById = vi.fn().mockResolvedValue(null);
    await expect(svc.issue(reservation.id, 12400, 'usd')).rejects.toThrow(NotFoundException);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('finds an invoice by reservation id', async () => {
    repo.findByReservationId = vi.fn().mockResolvedValue(invoiceRow());
    const out = await svc.findByReservationId(reservation.id);
    expect(repo.findByReservationId).toHaveBeenCalledWith(reservation.id);
    expect(out.number).toBe('INV-abc');
  });

  it('throws NotFound when invoice does not exist for reservation', async () => {
    await expect(svc.findByReservationId(reservation.id)).rejects.toThrow(NotFoundException);
  });
});
