import { Module } from '@nestjs/common';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { HoldExpiryModule } from '../hold-expiry/hold-expiry.module';
import { SeatsController } from './seats.controller';
import { SeatsService } from './seats.service';
import { DrizzleSeatsRepository } from './adapters/drizzle.seats.repository';
import { SEATS_REPOSITORY } from './seats.ports';

@Module({
  imports: [DrizzleModule, HoldExpiryModule],
  controllers: [SeatsController],
  providers: [
    SeatsService,
    { provide: SEATS_REPOSITORY, useClass: DrizzleSeatsRepository },
  ],
  exports: [SeatsService, SEATS_REPOSITORY],
})
export class SeatsModule {}
