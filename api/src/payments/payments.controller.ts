import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
  UseGuards,
  type RawBodyRequest,
} from '@nestjs/common';
import { InternalServerErrorException } from '@nestjs/common';
import type { Request } from 'express';
import {
  CreatePaymentRequestSchema,
  type CreatePaymentRequest,
  type CreatePaymentResponse,
  type PaymentResponse,
} from '@linkz/shared';
import { ClerkGuard, type AuthenticatedRequest } from '../clerk/clerk.guard';
import { UserResolver } from '../users/user.resolver';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  @Post()
  @UseGuards(ClerkGuard, UserResolver)
  async create(
    @Body(new ZodValidationPipe(CreatePaymentRequestSchema)) body: CreatePaymentRequest,
    @Req() req: AuthenticatedRequest,
  ): Promise<CreatePaymentResponse> {
    if (!req.appUser) throw new InternalServerErrorException('User not resolved');
    return this.service.createPayment(body.reservationId, req.appUser);
  }

  @Get()
  @UseGuards(ClerkGuard, UserResolver)
  async poll(
    @Query(new ZodValidationPipe(CreatePaymentRequestSchema)) query: CreatePaymentRequest,
    @Req() req: AuthenticatedRequest,
  ): Promise<PaymentResponse> {
    if (!req.appUser) throw new InternalServerErrorException('User not resolved');
    return this.service.getPaymentByReservation(query.reservationId, req.appUser.id);
  }

  @Post('verify')
  @UseGuards(ClerkGuard, UserResolver)
  @HttpCode(204)
  async verify(
    @Body(new ZodValidationPipe(CreatePaymentRequestSchema)) body: CreatePaymentRequest,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    if (!req.appUser) throw new InternalServerErrorException('User not resolved');
    await this.service.verifyPayment(body.reservationId, req.appUser.id);
  }

  @Post('webhook')
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature: string) {
    if (!req.rawBody) throw new BadRequestException('Missing raw body');
    await this.service.handleWebhook(req.rawBody, signature);
    return { received: true };
  }
}
