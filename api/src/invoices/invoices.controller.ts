import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ClerkGuard } from '../clerk/clerk.guard';
import { InvoicesService } from './invoices.service';

@Controller('invoices')
@UseGuards(ClerkGuard)
export class InvoicesController {
  constructor(private readonly service: InvoicesService) {}

  @Get(':reservationId')
  async findByReservationId(@Param('reservationId') reservationId: string) {
    return this.service.findByReservationId(reservationId);
  }
}
