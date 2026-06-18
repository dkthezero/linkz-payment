import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { SeatsController } from './seats.controller';
import type { SeatsService } from './seats.service';

const svc = (over: Partial<SeatsService> = {}): SeatsService =>
  ({ findAll: vi.fn(), findById: vi.fn(), ...over }) as unknown as SeatsService;

const seat = {
  id: '550e8400-e29b-41d4-a716-446655440010',
  label: 'A1',
  price: 12000,
  status: 'available' as const,
};

describe('SeatsController.findAll', () => {
  it('delegates to the service', async () => {
    const service = svc({ findAll: vi.fn().mockResolvedValue([seat]) });
    const ctrl = new SeatsController(service);
    const out = await ctrl.findAll();
    expect(service.findAll).toHaveBeenCalled();
    expect(out).toEqual([seat]);
  });
});

describe('SeatsController.findById', () => {
  it('delegates to the service with the id', async () => {
    const service = svc({ findById: vi.fn().mockResolvedValue(seat) });
    const ctrl = new SeatsController(service);
    const out = await ctrl.findById(seat.id);
    expect(service.findById).toHaveBeenCalledWith(seat.id);
    expect(out).toEqual(seat);
  });

  it('lets service errors propagate (e.g. NotFound)', async () => {
    const service = svc({ findById: vi.fn().mockRejectedValue(new NotFoundException()) });
    const ctrl = new SeatsController(service);
    await expect(ctrl.findById('nope')).rejects.toThrow(NotFoundException);
  });
});
