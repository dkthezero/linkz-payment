import { BadRequestException, Injectable } from '@nestjs/common';
import type { PaymentProviderPort, ProviderEvent } from '../payments.ports';

/** Known test-only webhook signature. The test-succeed route passes this;
 * constructEvent rejects anything else so the test provider does not accept
 * arbitrary signatures (the previous implementation ignored the arg). */
export const TEST_WEBHOOK_SIGNATURE = 'test-signature';

export const TEST_PAYMENT_PROVIDER_TYPE = 'test';

export interface TestCheckoutSession {
  providerRef: string;
  checkoutUrl: string;
  paymentId: string;
  reservationId: string;
}

@Injectable()
export class TestPaymentProvider implements PaymentProviderPort {
  private sessions = new Map<string, TestCheckoutSession>();

  async createCheckoutSession(input: {
    paymentId: string;
    reservationId: string;
    amount: number;
    currency: string;
    idempotencyKey: string;
  }): Promise<{ providerRef: string; checkoutUrl: string }> {
    const providerRef = `cs_test_${input.paymentId}`;
    // Success URL carries reservationId so the success page can poll without a
    // separate lookup. Mirrors the Stripe provider's success_url shape.
    const checkoutUrl = `/checkout/success?paymentId=${encodeURIComponent(input.paymentId)}&reservationId=${encodeURIComponent(input.reservationId)}`;
    this.sessions.set(providerRef, {
      providerRef,
      checkoutUrl,
      paymentId: input.paymentId,
      reservationId: input.reservationId,
    });
    return { providerRef, checkoutUrl };
  }

  constructEvent(rawBody: Buffer | string, signature: string): ProviderEvent {
    if (signature !== TEST_WEBHOOK_SIGNATURE) {
      throw new BadRequestException('Invalid test webhook signature');
    }
    const payload = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf-8');
    const parsed = JSON.parse(payload) as {
      id: string;
      type: string;
      paymentId: string;
      reservationId: string;
      isPaid?: boolean;
    };
    return {
      id: parsed.id,
      type: parsed.type,
      paymentId: parsed.paymentId,
      isPaid: parsed.isPaid ?? true,
      raw: parsed,
    };
  }

  async fetchSessionEvent(providerRef: string): Promise<import('../payments.ports').ProviderEvent | null> {
    const session = this.sessions.get(providerRef);
    if (!session) return null;
    return {
      id: `verify_${providerRef}`,
      type: 'checkout.session.completed',
      paymentId: session.paymentId,
      isPaid: true,
      raw: session,
    };
  }

  getSession(providerRef: string): TestCheckoutSession | undefined {
    return this.sessions.get(providerRef);
  }
}