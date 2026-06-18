import { describe, it, expect } from 'vitest';
import { computePricing } from './pricing';

describe('computePricing', () => {
  it('12000 + 400 => total 12400', () => {
    expect(computePricing([12000], 400)).toEqual({ seatPrice: 12000, serviceFee: 400, total: 12400 });
  });
  it('sums multiple seats', () => {
    expect(computePricing([12000, 9500], 400)).toEqual({ seatPrice: 21500, serviceFee: 400, total: 21900 });
  });
  it('80 + 0 => total 80', () => {
    expect(computePricing([80], 0)).toEqual({ seatPrice: 80, serviceFee: 0, total: 80 });
  });
  it('0 + 0 => all 0', () => {
    expect(computePricing([0], 0)).toEqual({ seatPrice: 0, serviceFee: 0, total: 0 });
  });
  it('empty seats => seatPrice 0, fee unchanged', () => {
    expect(computePricing([], 400)).toEqual({ seatPrice: 0, serviceFee: 400, total: 400 });
  });
});
