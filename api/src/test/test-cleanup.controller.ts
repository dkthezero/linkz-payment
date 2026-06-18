import { Controller, Param, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, sql } from 'drizzle-orm';
import { reservations } from '@linkz/database';
import { DrizzleService } from '../drizzle/drizzle.service';

@Controller('test')
export class TestCleanupController {
  constructor(
    private readonly drizzle: DrizzleService,
    private readonly config: ConfigService,
  ) {}

  private assertTestMode() {
    const nodeEnv = this.config.get<string>('NODE_ENV') ?? 'development';
    const bypassAuth = this.config.get<boolean>('CLERK_BYPASS_AUTH') ?? false;
    if (nodeEnv === 'production' || !bypassAuth) {
      throw new UnauthorizedException('Test endpoints are only available in non-production bypass mode');
    }
  }

  @Post('cleanup')
  async cleanup() {
    this.assertTestMode();
    await this.drizzle.db.execute(
      sql`TRUNCATE TABLE reservations, reservation_seats, payments, tickets, webhook_events RESTART IDENTITY CASCADE`,
    );
    return { cleaned: true };
  }

  @Post('expire-reservation/:id')
  async expireReservation(@Param('id') id: string) {
    this.assertTestMode();
    await this.drizzle.db
      .update(reservations)
      .set({ holdExpiresAt: sql`now() - interval '1 second'` })
      .where(eq(reservations.id, id));
    return { expired: true };
  }

  @Post('release-reservation/:id')
  async releaseReservation(@Param('id') id: string) {
    this.assertTestMode();
    await this.drizzle.db
      .update(reservations)
      .set({ status: 'released', sagaStep: 'released', holdExpiresAt: null, updatedAt: new Date() })
      .where(eq(reservations.id, id));
    return { released: true };
  }
}