import { Module } from '@nestjs/common';
import { ClerkModule } from '../clerk/clerk.module';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { UsersModule } from '../users/users.module';
import { PricingModule } from '../pricing/pricing.module';
import { SeatsModule } from '../seats/seats.module';
import { HoldExpiryModule } from '../hold-expiry/hold-expiry.module';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';
import { DrizzleReservationsRepository } from './adapters/drizzle.reservations.repository';
import { RESERVATIONS_REPOSITORY } from './reservations.ports';

@Module({
  imports: [DrizzleModule, ClerkModule, UsersModule, PricingModule, SeatsModule, HoldExpiryModule],
  controllers: [ReservationsController],
  providers: [
    ReservationsService,
    { provide: RESERVATIONS_REPOSITORY, useClass: DrizzleReservationsRepository },
  ],
  exports: [ReservationsService, RESERVATIONS_REPOSITORY],
})
export class ReservationsModule {}
