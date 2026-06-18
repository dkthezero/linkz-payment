/**
 * Pure pricing calc. `total = sum(seatPrices) + serviceFee`. Caller validates
 * inputs are non-negative integers (minor units). Single source of truth shared
 * by checkout review + payment creation so amounts cannot drift.
 */
export function computePricing(seatPrices: number[], feeMinor: number): {
  seatPrice: number;
  serviceFee: number;
  total: number;
} {
  const seatTotal = seatPrices.reduce((sum, price) => sum + price, 0);
  return {
    seatPrice: seatTotal,
    serviceFee: feeMinor,
    total: seatTotal + feeMinor,
  };
}
