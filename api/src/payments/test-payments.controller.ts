import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { PaymentSuccessRequestSchema, type PaymentSuccessRequest } from '@linkz/shared';
import { ClerkGuard } from '../clerk/clerk.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PaymentsService } from './payments.service';
import { TEST_WEBHOOK_SIGNATURE } from './adapters/test.payment-provider';

/**
 * Pure decision: should the test-succeed route be registered? Extracted so the
 * production-safety gate is unit-testable without booting Nest (and without
 * triggering apiEnvSchema.parse at import time). Production never registers
 * the route, regardless of PAYMENT_PROVIDER.
 */
export function shouldRegisterTestPayments(env: {
  PAYMENT_PROVIDER: string;
  NODE_ENV: string;
}): boolean {
  return env.PAYMENT_PROVIDER === 'test' && env.NODE_ENV !== 'production';
}

/**
 * Test-only `test-succeed` route. This controller is registered by
 * PaymentsModule ONLY when PAYMENT_PROVIDER === 'test' AND NODE_ENV !==
 * 'production', so the route is unreachable in production at the DI/routing
 * level (not merely mitigated by a provider swap). The handler drives a
 * webhook through the normal handleWebhook path using the test provider's
 * known signature constant.
 */
@Controller('payments')
export class TestPaymentsController {
  constructor(private readonly service: PaymentsService) {}

  @Post('test-succeed')
  @UseGuards(ClerkGuard)
  async testSucceed(@Body(new ZodValidationPipe(PaymentSuccessRequestSchema)) body: PaymentSuccessRequest) {
    const event = {
      id: `evt_test_${body.paymentId}`,
      type: 'test.checkout.session.completed',
      paymentId: body.paymentId,
      reservationId: body.reservationId,
      isPaid: true,
    };
    await this.service.handleWebhook(Buffer.from(JSON.stringify(event)), TEST_WEBHOOK_SIGNATURE);
    return { received: true };
  }
}