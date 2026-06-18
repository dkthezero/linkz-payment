import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import type { ReservationsRepository } from '../reservations/reservations.ports';
import type { TicketsRepository, TicketRow, NewTicket } from './tickets.ports';

const reservation = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  userId: '550e8400-e29b-41d4-a716-446655440002',
  status: 'confirmed' as const,
  sagaStep: 'confirmed',
  holdExpiresAt: null,
  createdAt: new Date(),
};

const seatA = '550e8400-e29b-41d4-a716-446655440010';
const seatB = '550e8400-e29b-41d4-a716-446655440011';

const ticketRow = (over: Partial<TicketRow> = {}): TicketRow => ({
  id: '550e8400-e29b-41d4-a716-446655440003',
  reservationId: reservation.id,
  seatId: seatA,
  serial: 'T-abc',
  qrCode: null,
  issuedAt: new Date(),
  ...over,
});

const makeReservations = (): ReservationsRepository => ({
  insert: vi.fn(),
  findById: vi.fn().mockResolvedValue(reservation),
  findWithSeats: vi.fn(),
  listByUser: vi.fn(),
  findSeatIds: vi.fn().mockResolvedValue([seatA, seatB]),
  confirm: vi.fn(),
});

const makeRepo = (): TicketsRepository => ({
  insert: vi.fn().mockImplementation((input: NewTicket) =>
    Promise.resolve(ticketRow({ reservationId: input.reservationId, seatId: input.seatId })),
  ),
  findByReservationId: vi.fn().mockResolvedValue([]),
});

describe('TicketsService', () => {
  let reservations: ReservationsRepository;
  let repo: TicketsRepository;
  let svc: TicketsService;

  beforeEach(() => {
    reservations = makeReservations();
    repo = makeRepo();
    svc = new TicketsService(repo, reservations);
  });

  it('issues one ticket per seat for a confirmed reservation', async () => {
    const out = await svc.issue(reservation.id);
    expect(reservations.findById).toHaveBeenCalledWith(reservation.id);
    expect(reservations.findSeatIds).toHaveBeenCalledWith(reservation.id);
    expect(repo.insert).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(2);
    expect(out[0].serial).toMatch(/^T-/);
    expect(out.every((t) => t.reservationId === reservation.id)).toBe(true);
  });

  it('reuses existing tickets and only creates missing ones', async () => {
    repo.findByReservationId = vi.fn().mockResolvedValue([ticketRow({ seatId: seatA })]);
    const out = await svc.issue(reservation.id);
    expect(repo.insert).toHaveBeenCalledTimes(1);
    const insertedSeatId = (repo.insert as ReturnType<typeof vi.fn>).mock.calls[0][0].seatId as string;
    expect(insertedSeatId).toBe(seatB);
    expect(out).toHaveLength(2);
  });

  it('throws NotFound when issuing for a missing reservation', async () => {
    reservations.findById = vi.fn().mockResolvedValue(null);
    await expect(svc.issue(reservation.id)).rejects.toThrow(NotFoundException);
  });

  it('throws Conflict when reservation is not confirmed', async () => {
    reservations.findById = vi.fn().mockResolvedValue({ ...reservation, status: 'held' });
    await expect(svc.issue(reservation.id)).rejects.toThrow(ConflictException);
  });

  it('finds tickets by reservation id', async () => {
    repo.findByReservationId = vi.fn().mockResolvedValue([
      ticketRow(),
      ticketRow({ id: '550e8400-e29b-41d4-a716-4466554400ff', seatId: seatB }),
    ]);
    const out = await svc.findByReservationId(reservation.id);
    expect(repo.findByReservationId).toHaveBeenCalledWith(reservation.id);
    expect(out).toHaveLength(2);
    expect(out[0].serial).toBe('T-abc');
  });

  it('throws NotFound when no tickets exist for the reservation', async () => {
    repo.findByReservationId = vi.fn().mockResolvedValue([]);
    await expect(svc.findByReservationId(reservation.id)).rejects.toThrow(NotFoundException);
  });
});
