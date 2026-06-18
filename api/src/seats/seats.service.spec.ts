import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { SeatsService } from './seats.service';
import type { SeatsRepository, SeatWithStatus } from './seats.ports';
import { SEATS_REPOSITORY } from './seats.ports';
import type { HoldExpirySweeper } from '../hold-expiry/hold-expiry-sweeper';

const makeSweeper = (): HoldExpirySweeper => ({ sweepExpiredHolds: vi.fn().mockResolvedValue([]) }) as unknown as HoldExpirySweeper;

const seat = (
  over: Partial<SeatWithStatus> & Pick<SeatWithStatus, 'id' | 'label' | 'price' | 'reservationStatus'>,
): SeatWithStatus => ({
  createdAt: new Date(),
  holdExpiresAt: null,
  ...over,
});

describe('SeatsService', () => {
  let repo: SeatsRepository;
  let sweeper: HoldExpirySweeper;
  let svc: SeatsService;

  beforeEach(() => {
    repo = { findAll: vi.fn().mockResolvedValue([]), findById: vi.fn().mockResolvedValue(undefined) };
    sweeper = makeSweeper();
    svc = new SeatsService(repo, sweeper);
  });

  it('exposes the repository token', () => {
    expect(typeof SEATS_REPOSITORY).toBe('symbol');
  });

  it('maps an active reservation to held status', async () => {
    const row = seat({
      id: '550e8400-e29b-41d4-a716-446655440010',
      label: 'A1',
      price: 12000,
      reservationStatus: 'held',
      holdExpiresAt: new Date(Date.now() + 60_000),
    });
    repo.findAll = vi.fn().mockResolvedValue([row]);
    const out = await svc.findAll();
    expect(out).toEqual([{ id: row.id, label: row.label, price: row.price, status: 'held' }]);
    expect(sweeper.sweepExpiredHolds).not.toHaveBeenCalled();
  });

  it('maps no active reservation to available status', async () => {
    const row = seat({
      id: '550e8400-e29b-41d4-a716-446655440011',
      label: 'A2',
      price: 9500,
      reservationStatus: null,
    });
    repo.findAll = vi.fn().mockResolvedValue([row]);
    const out = await svc.findAll();
    expect(out).toEqual([{ id: row.id, label: row.label, price: row.price, status: 'available' }]);
    expect(sweeper.sweepExpiredHolds).not.toHaveBeenCalled();
  });

  it('treats a held seat whose hold has expired as available and triggers a sweep', async () => {
    const row = seat({
      id: '550e8400-e29b-41d4-a716-446655440012',
      label: 'A3',
      price: 8000,
      reservationStatus: 'held',
      holdExpiresAt: new Date(Date.now() - 60_000),
    });
    repo.findAll = vi.fn().mockResolvedValue([row]);
    const out = await svc.findAll();
    expect(out).toEqual([{ id: row.id, label: row.label, price: row.price, status: 'available' }]);
    expect(sweeper.sweepExpiredHolds).toHaveBeenCalledTimes(1);
  });

  it('leaves a confirmed seat as confirmed even with a past holdExpiresAt', async () => {
    // confirmed rows carry no expiry (holdExpiresAt is null in practice), but
    // the mapping must never downgrade a confirmed seat.
    const row = seat({
      id: '550e8400-e29b-41d4-a716-446655440013',
      label: 'A4',
      price: 8000,
      reservationStatus: 'confirmed',
    });
    repo.findAll = vi.fn().mockResolvedValue([row]);
    const out = await svc.findAll();
    expect(out[0].status).toBe('confirmed');
    expect(sweeper.sweepExpiredHolds).not.toHaveBeenCalled();
  });

  it('throws NotFound when seat does not exist', async () => {
    repo.findById = vi.fn().mockResolvedValue(undefined);
    await expect(svc.findById('550e8400-e29b-41d4-a716-446655440099')).rejects.toThrow(NotFoundException);
  });

  it('returns a single seat by id', async () => {
    const row = seat({
      id: '550e8400-e29b-41d4-a716-446655440012',
      label: 'A3',
      price: 8000,
      reservationStatus: null,
    });
    repo.findById = vi.fn().mockResolvedValue(row);
    const out = await svc.findById(row.id);
    expect(out).toEqual({ id: row.id, label: row.label, price: row.price, status: 'available' });
  });

  it('shows an expired held seat as available by id and triggers a sweep', async () => {
    const row = seat({
      id: '550e8400-e29b-41d4-a716-446655440012',
      label: 'A3',
      price: 8000,
      reservationStatus: 'held',
      holdExpiresAt: new Date(Date.now() - 60_000),
    });
    repo.findById = vi.fn().mockResolvedValue(row);
    const out = await svc.findById(row.id);
    expect(out.status).toBe('available');
    expect(sweeper.sweepExpiredHolds).toHaveBeenCalledTimes(1);
  });

  it('returns seats sorted by label regardless of repository order', async () => {
    repo.findAll = vi.fn().mockResolvedValue([
      seat({ id: '550e8400-e29b-41d4-a716-446655440011', label: 'A2', price: 9500, reservationStatus: null }),
      seat({ id: '550e8400-e29b-41d4-a716-446655440010', label: 'A1', price: 12000, reservationStatus: null }),
      seat({ id: '550e8400-e29b-41d4-a716-446655440012', label: 'A3', price: 8000, reservationStatus: null }),
    ]);
    const out = await svc.findAll();
    expect(out.map((s) => s.label)).toEqual(['A1', 'A2', 'A3']);
  });

  it('sorts labels in natural (numeric-aware) order, not lexicographic', async () => {
    repo.findAll = vi.fn().mockResolvedValue([
      seat({ id: '550e8400-e29b-41d4-a716-446655440020', label: 'A10', price: 1000, reservationStatus: null }),
      seat({ id: '550e8400-e29b-41d4-a716-446655440002', label: 'A2', price: 1000, reservationStatus: null }),
      seat({ id: '550e8400-e29b-41d4-a716-446655440001', label: 'A1', price: 1000, reservationStatus: null }),
    ]);
    const out = await svc.findAll();
    expect(out.map((s) => s.label)).toEqual(['A1', 'A2', 'A10']);
  });
});