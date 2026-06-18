import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { computePricing } from './pricing';

@Injectable()
export class PricingService {
  constructor(private readonly config: ConfigService) {}

  feeMinor(): number {
    return this.config.get<number>('SERVICE_FEE_AMOUNT') ?? 400;
  }

  currency(): string {
    return this.config.get<string>('SERVICE_FEE_CURRENCY') ?? 'usd';
  }

  compute(seatPrices: number[]): { seatPrice: number; serviceFee: number; total: number; currency: string } {
    const { seatPrice, serviceFee, total } = computePricing(seatPrices, this.feeMinor());
    return { seatPrice, serviceFee, total, currency: this.currency() };
  }
}
