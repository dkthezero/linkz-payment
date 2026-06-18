import { Module } from '@nestjs/common';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { ClerkModule } from '../clerk/clerk.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { DrizzleTicketsRepository } from './adapters/drizzle.tickets.repository';
import { TICKETS_REPOSITORY } from './tickets.ports';

@Module({
  imports: [DrizzleModule, ClerkModule, ReservationsModule],
  controllers: [TicketsController],
  providers: [
    TicketsService,
    { provide: TICKETS_REPOSITORY, useClass: DrizzleTicketsRepository },
  ],
  exports: [TicketsService, TICKETS_REPOSITORY],
})
export class TicketsModule {}
