import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, ForbiddenException, GoneException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { ReservationsService } from './reservations.service';
import {
  RESERVATIONS_REPOSITORY,
  type ReservationsRepository,
  type ReservationRow,
  type ReservationWithSeats,
} from './reservations.ports';
import { SEATS_REPOSITORY, type SeatsRepository } from '../seats/seats.ports';
import { PricingService } from '../pricing/pricing.service';
import type { HoldExpirySweeper } from '../hold-expiry/hold-expiry-sweeper';

const makeConfig = (over: Record<string, unknown> = {}): ConfigService =>
  ({ get: vi.fn((key: string) => over[key] ?? defaults[key]) }) as unknown as ConfigService;

const defaults: Record<string, unknown> = {
  HOLD_TTL_MINUTES: 1,
  SERVICE_FEE_AMOUNT: 400,
  SERVICE_FEE_CURRENCY: 'usd',
};

const makeRepo = (): ReservationsRepository => ({
  insert: vi.fn().mockResolvedValue(null),
  findById: vi.fn().mockResolvedValue(null),
  findWithSeats: vi.fn().mockResolvedValue(null),
  listByUser: vi.fn().mockResolvedValue([]),
  findSeatIds: vi.fn().mockResolvedValue([]),
  confirm: vi.fn().mockResolvedValue(undefined),
  release: vi.fn().mockResolvedValue(true),
  releaseConfirmedSeats: vi.fn().mockResolvedValue(undefined),
});

const makeSeats = (): SeatsRepository => ({
  findAll: vi.fn().mockResolvedValue([]),
  findById: vi.fn().mockResolvedValue(undefined),
});

const makePricing = (): PricingService =>
  ({
    compute: vi.fn((prices: number[]) => ({
      seatPrice: prices.reduce((a, b) => a + b, 0),
      serviceFee: 400,
      total: prices.reduce((a, b) => a + b, 0) + 400,
      currency: 'usd',
    })),
  }) as unknown as PricingService;

const makeSweeper = (): HoldExpirySweeper => ({ sweepExpiredHolds: vi.fn().mockResolvedValue([]) }) as unknown as HoldExpirySweeper;

const user = { id: '550e8400-e29b-41d4-a716-446655440001', externalId: 'user_1', email: 'a@b.com', name: 'Alice' };
const otherUser = { id: '550e8400-e29b-41d4-a716-446655440099', externalId: 'user_2', email: 'x@y.com', name: 'Bob' };
const futureExpiry = new Date(Date.now() + 10 * 60 * 1000);
const pastExpiry = new Date(Date.now() - 10 * 60 * 1000);

const heldRow: ReservationRow = {
  id: '550e8400-e29b-41d4-a716-446655440002',
  userId: user.id,
  status: 'held',
  sagaStep: 'createPayment',
  holdExpiresAt: futureExpiry,
  version: 3,
  createdAt: new Date(),
};

const seatA = { id: '550e8400-e29b-41d4-a716-446655440010', label: 'A1', price: 12000 };
const seatB = { id: '550e8400-e29b-41d4-a716-446655440011', label: 'A2', price: 9500 };
const joined = (): ReservationWithSeats => ({ reservation: { ...heldRow }, seats: [{ ...seatA }, { ...seatB }] });

const makeSvc = (
  repo: ReservationsRepository,
  seats: SeatsRepository,
  config: ConfigService,
  pricing: PricingService,
  sweeper: HoldExpirySweeper,
) => new ReservationsService(repo, seats, config, pricing, sweeper);

describe('ReservationsService', () => {
  let repo: ReservationsRepository;
  let seats: SeatsRepository;
  let pricing: PricingService;
  let sweeper: HoldExpirySweeper;
  let svc: ReservationsService;

  beforeEach(() => {
    repo = makeRepo();
    seats = makeSeats();
    pricing = makePricing();
    sweeper = makeSweeper();
    svc = makeSvc(repo, seats, makeConfig(), pricing, sweeper);
  });

  it('exposes the repository token', () => {
    expect(typeof RESERVATIONS_REPOSITORY).toBe('symbol');
  });

  it('holds multiple seats and returns a reservation id', async () => {
    repo.insert = vi.fn().mockResolvedValue(heldRow);
    seats.findById = vi.fn().mockImplementation((id: string) => Promise.resolve([seatA, seatB].find((s) => s.id === id)));
    const out = await svc.hold([seatA.id, seatB.id], user);
    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.id,
        status: 'held',
        sagaStep: 'createPayment',
      }),
      [seatA.id, seatB.id],
    );
    expect(out.reservationId).toBe(heldRow.id);
  });

  it('returns 404 when a requested seat does not exist', async () => {
    seats.findById = vi.fn().mockResolvedValue(undefined);
    await expect(svc.hold(['550e8400-e29b-41d4-a716-446655440099'], user)).rejects.toThrow(NotFoundException);
  });

  it('deduplicates repeated seat ids before holding', async () => {
    repo.insert = vi.fn().mockResolvedValue(heldRow);
    seats.findById = vi.fn().mockResolvedValue(seatA);
    await svc.hold([seatA.id, seatA.id], user);
    const seatIds = (repo.insert as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
    expect(seatIds).toEqual([seatA.id]);
  });

  it('throws Conflict when any seat is already actively reserved', async () => {
    const dbError = new Error('duplicate');
    (dbError as { cause: { code: string } }).cause = { code: '23505' };
    repo.insert = vi.fn().mockRejectedValue(dbError);
    seats.findById = vi.fn().mockResolvedValue(seatA);
    await expect(svc.hold([seatA.id], user)).rejects.toThrow(ConflictException);
  });

  it('frees confirmed (paid) seat slots before the atomic hold so a paid seat can be re-held (demo)', async () => {
    repo.insert = vi.fn().mockResolvedValue(heldRow);
    seats.findById = vi.fn().mockImplementation((id: string) => Promise.resolve([seatA, seatB].find((s) => s.id === id)));
    await svc.hold([seatA.id, seatB.id], user);
    // Confirmed slots are freed after the expiry sweep and before the insert,
    // so a previously-paid seat doesn't trip the partial-unique index.
    expect(repo.releaseConfirmedSeats).toHaveBeenCalledWith([seatA.id, seatB.id]);
    const sweepOrder = [
      (sweeper.sweepExpiredHolds as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
      (repo.releaseConfirmedSeats as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
      (repo.insert as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
    ];
    expect(sweepOrder).toEqual([...sweepOrder].sort());
  });

  describe('findById (owner-gated)', () => {
    it('own reservation => ok', async () => {
      repo.findById = vi.fn().mockResolvedValue(heldRow);
      repo.findSeatIds = vi.fn().mockResolvedValue([seatA.id, seatB.id]);
      const out = await svc.findById(heldRow.id, user.id);
      expect(out.id).toBe(heldRow.id);
      expect(out.seatIds).toEqual([seatA.id, seatB.id]);
    });
    it('other user => Forbidden', async () => {
      repo.findById = vi.fn().mockResolvedValue({ ...heldRow, userId: otherUser.id });
      await expect(svc.findById(heldRow.id, user.id)).rejects.toThrow(ForbiddenException);
    });
    it('missing => NotFound', async () => {
      repo.findById = vi.fn().mockResolvedValue(null);
      await expect(svc.findById('nope', user.id)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getCheckoutReview', () => {
    it('own + held => review with combined pricing', async () => {
      repo.findWithSeats = vi.fn().mockResolvedValue(joined());
      const out = await svc.getCheckoutReview(heldRow.id, user.id, user.email);
      expect(out.seats).toHaveLength(2);
      expect(out.pricing).toEqual({ seatPrice: 21500, serviceFee: 400, total: 21900, currency: 'usd' });
      expect(out.contact.email).toBe(user.email);
    });
    it('expired => Gone', async () => {
      repo.findWithSeats = vi.fn().mockResolvedValue({ reservation: { ...heldRow, holdExpiresAt: pastExpiry }, seats: [seatA] });
      await expect(svc.getCheckoutReview(heldRow.id, user.id, user.email)).rejects.toThrow(GoneException);
    });
    it('other user => Forbidden', async () => {
      repo.findWithSeats = vi.fn().mockResolvedValue({ reservation: { ...heldRow, userId: otherUser.id }, seats: [seatA] });
      await expect(svc.getCheckoutReview(heldRow.id, user.id, user.email)).rejects.toThrow(ForbiddenException);
    });
    it('missing => NotFound', async () => {
      repo.findWithSeats = vi.fn().mockResolvedValue(null);
      await expect(svc.getCheckoutReview('nope', user.id, user.email)).rejects.toThrow(NotFoundException);
    });
  });

  describe('release', () => {
    it('own + held => released with repo.release called using row.version', async () => {
      repo.findById = vi.fn().mockResolvedValue(heldRow);
      (repo.release as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      await svc.release(heldRow.id, user.id);
      expect(repo.release).toHaveBeenCalledWith(heldRow.id, heldRow.version);
    });
    it('own + no longer held (stale version) => Conflict', async () => {
      repo.findById = vi.fn().mockResolvedValue(heldRow);
      (repo.release as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      await expect(svc.release(heldRow.id, user.id)).rejects.toThrow(ConflictException);
    });
    it('other user => Forbidden', async () => {
      repo.findById = vi.fn().mockResolvedValue({ ...heldRow, userId: otherUser.id });
      await expect(svc.release(heldRow.id, user.id)).rejects.toThrow(ForbiddenException);
    });
    it('missing => NotFound', async () => {
      repo.findById = vi.fn().mockResolvedValue(null);
      await expect(svc.release('nope', user.id)).rejects.toThrow(NotFoundException);
    });
  });

  describe('listByUser', () => {
    it('returns the own rows from the repo with seat ids', async () => {
      const rows: ReservationRow[] = [heldRow, { ...heldRow, id: '550e8400-e29b-41d4-a716-446655440003' }];
      repo.listByUser = vi.fn().mockResolvedValue(rows);
      repo.findSeatIds = vi.fn().mockResolvedValue([seatA.id]);
      const out = await svc.listByUser(user.id);
      expect(repo.listByUser).toHaveBeenCalledWith(user.id);
      expect(out).toHaveLength(2);
      expect(out[0].seatIds).toEqual([seatA.id]);
    });
  });

  it('confirms a held reservation', async () => {
    repo.findById = vi.fn().mockResolvedValue({ ...heldRow, status: 'confirmed', sagaStep: 'confirmed' });
    repo.findSeatIds = vi.fn().mockResolvedValue([seatA.id]);
    const out = await svc.confirm(heldRow.id);
    expect(repo.confirm).toHaveBeenCalledWith(heldRow.id);
    expect(out.status).toBe('confirmed');
  });

  it('throws NotFound when confirming a missing reservation', async () => {
    repo.confirm = vi.fn().mockRejectedValue(new NotFoundException());
    await expect(svc.confirm('nope')).rejects.toThrow(NotFoundException);
  });
});
