import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { apiEnvSchema } from '@linkz/config';
import { HealthController } from '../health/health.controller';
import { MeController } from '../me/me.controller';
import { ClerkModule } from '../clerk/clerk.module';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { PaymentsModule } from '../payments/payments.module';
import { PricingModule } from '../pricing/pricing.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { SeatsModule } from '../seats/seats.module';
import { TicketsModule } from '../tickets/tickets.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { UsersModule } from '../users/users.module';
import { TestCleanupController } from '../test/test-cleanup.controller';

// Register the unauthenticated test-cleanup controller ONLY in non-production
// environments with the test-auth bypass explicitly enabled. Reads the typed,
// validated env via apiEnvSchema (the same schema ConfigModule validates
// against), never raw process.env. The schema's superRefine refuses to boot
// in production if any bypass env is set, so this is defense-in-depth on top
// of the fail-fast.
const parsedEnv = apiEnvSchema.parse(process.env);
const testControllers =
  parsedEnv.NODE_ENV !== 'production' && parsedEnv.CLERK_BYPASS_AUTH ? [TestCleanupController] : [];

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: (env) => apiEnvSchema.parse(env) }),
    ClerkModule,
    DrizzleModule,
    PaymentsModule,
    PricingModule,
    ReservationsModule,
    SeatsModule,
    TicketsModule,
    InvoicesModule,
    UsersModule,
  ],
  controllers: [HealthController, MeController, ...testControllers],
})
export class AppModule {}
