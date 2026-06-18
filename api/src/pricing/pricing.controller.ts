import { Controller, Get } from '@nestjs/common';
import { PricingService } from './pricing.service';

/**
 * Public pricing endpoint. NO auth guard — consumed by the SeatMap before the
 * user is authenticated, so it must not require a session. Returns the service
 * fee + currency from config (single source of truth).
 */
@Controller('pricing')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Get()
  getPublicPricing(): { serviceFee: number; currency: string } {
    return {
      serviceFee: this.pricingService.feeMinor(),
      currency: this.pricingService.currency(),
    };
  }
}
