import { Module } from '@nestjs/common';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { ClerkModule } from '../clerk/clerk.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { DrizzleInvoicesRepository } from './adapters/drizzle.invoices.repository';
import { INVOICES_REPOSITORY } from './invoices.ports';

@Module({
  imports: [DrizzleModule, ClerkModule, ReservationsModule],
  controllers: [InvoicesController],
  providers: [
    InvoicesService,
    { provide: INVOICES_REPOSITORY, useClass: DrizzleInvoicesRepository },
  ],
  exports: [InvoicesService, INVOICES_REPOSITORY],
})
export class InvoicesModule {}
