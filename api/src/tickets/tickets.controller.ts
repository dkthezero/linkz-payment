import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ClerkGuard } from '../clerk/clerk.guard';
import { TicketsService } from './tickets.service';

@Controller('tickets')
@UseGuards(ClerkGuard)
export class TicketsController {
  constructor(private readonly service: TicketsService) {}

  @Get(':reservationId')
  async findByReservationId(@Param('reservationId') reservationId: string) {
    return this.service.findByReservationId(reservationId);
  }
}
