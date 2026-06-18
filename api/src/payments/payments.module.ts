import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { apiEnvSchema } from '@linkz/config';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { ClerkModule } from '../clerk/clerk.module';
import { UsersModule } from '../users/users.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { TicketsModule } from '../tickets/tickets.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { PaymentsController } from './payments.controller';
import { TestPaymentsController, shouldRegisterTestPayments } from './test-payments.controller';
import { PaymentsService } from './payments.service';
import { SagaProcessor } from '../saga/saga.processor';
import { StripePaymentProvider } from './adapters/stripe.payment-provider';
import { TestPaymentProvider } from './adapters/test.payment-provider';
import { DrizzlePaymentsRepository } from './adapters/drizzle.payments.repository';
import {
  PAYMENT_PROVIDER,
  PAYMENTS_REPOSITORY,
  type PaymentProviderPort,
} from './payments.ports';

// Register the test-succeed controller ONLY in non-production environments
// using the test payment provider. Reads the typed, validated env via
// apiEnvSchema (the same schema ConfigModule validates against), never raw
// process.env. Defense-in-depth: apiEnvSchema defaults PAYMENT_PROVIDER to
// 'stripe', so production never registers this route even if this gate were
// bypassed. Mirrors the TestCleanupController gating pattern in AppModule.
const parsedEnv = apiEnvSchema.parse(process.env);
const testControllers = shouldRegisterTestPayments(parsedEnv) ? [TestPaymentsController] : [];

@Module({
  imports: [DrizzleModule, ClerkModule, UsersModule, ReservationsModule, TicketsModule, InvoicesModule],
  controllers: [PaymentsController, ...testControllers],
  providers: [
    PaymentsService,
    SagaProcessor,
    {
      provide: PAYMENT_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): PaymentProviderPort => {
        return config.get<string>('PAYMENT_PROVIDER') === 'test'
          ? new TestPaymentProvider()
          : new StripePaymentProvider(config);
      },
    },
    { provide: PAYMENTS_REPOSITORY, useClass: DrizzlePaymentsRepository },
  ],
})
export class PaymentsModule {}
