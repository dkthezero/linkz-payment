import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { CreateReservationRequestSchema } from '@linkz/shared';
import { ClerkGuard, type AuthenticatedRequest } from '../clerk/clerk.guard';
import { UserResolver } from '../users/user.resolver';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ReservationsService } from './reservations.service';

@Controller('reservations')
@UseGuards(ClerkGuard, UserResolver)
export class ReservationsController {
  constructor(private readonly service: ReservationsService) {}

  @Post()
  async create(
    @Body(new ZodValidationPipe(CreateReservationRequestSchema)) body: { seatIds: string[] },
    @Req() req: AuthenticatedRequest,
  ) {
    if (!req.appUser) throw new Error('User not resolved');
    return this.service.hold(body.seatIds, req.appUser);
  }

  @Get()
  async list(@Req() req: AuthenticatedRequest) {
    if (!req.appUser) throw new Error('User not resolved');
    return this.service.listByUser(req.appUser.id);
  }

  @Get(':id')
  async findById(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    if (!req.appUser) throw new Error('User not resolved');
    return this.service.findById(id, req.appUser.id);
  }

  @Get(':id/checkout')
  async checkoutReview(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    if (!req.appUser) throw new Error('User not resolved');
    return this.service.getCheckoutReview(id, req.appUser.id, req.appUser.email);
  }

  @Delete(':id')
  @HttpCode(204)
  async release(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    if (!req.appUser) throw new Error('User not resolved');
    await this.service.release(id, req.appUser.id);
  }
}
