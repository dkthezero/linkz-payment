import { Module } from '@nestjs/common';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { HoldExpirySweeper } from './hold-expiry-sweeper';

/**
 * Standalone maintenance service so the seats feature can trigger hold-expiry
 * reaping without importing the reservations module (which itself imports the
 * seats module) — i.e. no circular module dependency.
 */
@Module({
  imports: [DrizzleModule],
  providers: [HoldExpirySweeper],
  exports: [HoldExpirySweeper],
})
export class HoldExpiryModule {}