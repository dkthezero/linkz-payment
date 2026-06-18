import { describe, it, expect, vi } from 'vitest';
import type { AppUser } from '@linkz/shared';
import { ReservationsController } from './reservations.controller';
import type { ReservationsService } from './reservations.service';
import type { AuthenticatedRequest } from '../clerk/clerk.guard';

const svc = (over: Partial<ReservationsService> = {}): ReservationsService =>
  ({
    hold: vi.fn(),
    findById: vi.fn(),
    getCheckoutReview: vi.fn(),
    release: vi.fn(),
    listByUser: vi.fn(),
    confirm: vi.fn(),
    ...over,
  }) as unknown as ReservationsService;

const appUser: AppUser = { id: '550e8400-e29b-41d4-a716-446655440001', externalId: 'user_1', email: 'a@b.com', name: 'Alice' };
const req = (): AuthenticatedRequest => ({ appUser, user: appUser.externalId } as AuthenticatedRequest);

describe('ReservationsController.create', () => {
  it('delegates to service with seatIds + appUser', async () => {
    const service = svc({ hold: vi.fn().mockResolvedValue({ reservationId: 'r1' }) });
    const ctrl = new ReservationsController(service);
    const out = await ctrl.create({ seatIds: ['s1', 's2'] }, req());
    expect(service.hold).toHaveBeenCalledWith(['s1', 's2'], appUser);
    expect(out).toEqual({ reservationId: 'r1' });
  });
});

describe('ReservationsController.findById', () => {
  it('delegates to service with id + req.appUser.id', async () => {
    const service = svc({ findById: vi.fn().mockResolvedValue({ id: 'r1' }) });
    const ctrl = new ReservationsController(service);
    const out = await ctrl.findById('r1', req());
    expect(service.findById).toHaveBeenCalledWith('r1', appUser.id);
    expect(out).toEqual({ id: 'r1' });
  });
});

describe('ReservationsController.list', () => {
  it('delegates to listByUser with req.appUser.id', async () => {
    const service = svc({ listByUser: vi.fn().mockResolvedValue([{ id: 'r1' }]) });
    const ctrl = new ReservationsController(service);
    const out = await ctrl.list(req());
    expect(service.listByUser).toHaveBeenCalledWith(appUser.id);
    expect(out).toEqual([{ id: 'r1' }]);
  });
});

describe('ReservationsController.checkoutReview', () => {
  it('delegates to getCheckoutReview with id + req.appUser.id + req.appUser.email', async () => {
    const review = { reservation: { id: 'r1' }, seats: [], pricing: {}, contact: { email: appUser.email } };
    const service = svc({ getCheckoutReview: vi.fn().mockResolvedValue(review) });
    const ctrl = new ReservationsController(service);
    const out = await ctrl.checkoutReview('r1', req());
    expect(service.getCheckoutReview).toHaveBeenCalledWith('r1', appUser.id, appUser.email);
    expect(out).toEqual(review);
  });
});

describe('ReservationsController.release', () => {
  it('delegates to release with id + req.appUser.id and returns 204 (void)', async () => {
    const service = svc({ release: vi.fn().mockResolvedValue(undefined) });
    const ctrl = new ReservationsController(service);
    const out = await ctrl.release('r1', req());
    expect(service.release).toHaveBeenCalledWith('r1', appUser.id);
    expect(out).toBeUndefined();
  });
});
