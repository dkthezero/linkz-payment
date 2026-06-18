import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type { PaymentProviderPort, ProviderEvent } from '../payments.ports';

@Injectable()
export class StripePaymentProvider implements PaymentProviderPort {
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;
  private readonly successUrl: string;
  private readonly cancelUrl: string;

  constructor(config: ConfigService) {
    this.stripe = new Stripe(config.get<string>('STRIPE_SECRET_KEY') ?? '');
    this.webhookSecret = config.get<string>('STRIPE_WEBHOOK_SECRET') ?? '';
    this.successUrl = config.get<string>('STRIPE_SUCCESS_URL') ?? '';
    this.cancelUrl = config.get<string>('STRIPE_CANCEL_URL') ?? '';
  }

  async createCheckoutSession(input: {
    paymentId: string;
    reservationId: string;
    amount: number;
    currency: string;
    idempotencyKey: string;
  }): Promise<{ providerRef: string; checkoutUrl: string }> {
    const metadata = { paymentId: input.paymentId, reservationId: input.reservationId };
    // Append reservationId to success/cancel URLs so the success page can poll
    // the payment status (it only has reservationId from the redirect). Handles
    // both the no-query and already-has-query cases.
    const successUrl = withReservationId(this.successUrl, input.reservationId);
    const cancelUrl = withReservationId(this.cancelUrl, input.reservationId);
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'payment',
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: input.currency,
              unit_amount: input.amount,
              product_data: { name: 'Seat reservation' },
            },
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata,
        payment_intent_data: { metadata },
      },
      { idempotencyKey: input.idempotencyKey },
    );
    if (!session.url) throw new Error('Stripe did not return a checkout url');
    return { providerRef: session.id, checkoutUrl: session.url };
  }

  async fetchSessionEvent(providerRef: string): Promise<ProviderEvent | null> {
    const session = await this.stripe.checkout.sessions.retrieve(providerRef);
    if (session.payment_status !== 'paid') return null;
    // Prefix with 'verify_' so this id never collides with a real Stripe evt_xxx:
    // the ledger deduplicates repeated verify calls but still lets the real webhook
    // through (different id, saga runs idempotently a second time).
    return {
      id: `verify_${session.id}`,
      type: 'checkout.session.completed',
      paymentId: session.metadata?.paymentId ?? null,
      isPaid: true,
      raw: session,
    };
  }

  constructEvent(rawBody: Buffer | string, signature: string): ProviderEvent {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    } catch {
      throw new BadRequestException('Invalid webhook signature');
    }
    const obj = event.data.object as unknown as {
      metadata?: Record<string, string>;
      payment_status?: string;
    };
    return {
      id: event.id,
      type: event.type,
      paymentId: obj.metadata?.paymentId ?? null,
      isPaid: obj.payment_status === 'paid',
      raw: event,
    };
  }
}

/**
 * Append `reservationId=` to a base URL, using `?` if the URL has no query
 * string yet and `&` otherwise. Single source of truth for the success/cancel
 * URL shaping so both branches stay consistent.
 */
function withReservationId(baseUrl: string, reservationId: string): string {
  const sep = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${sep}reservationId=${encodeURIComponent(reservationId)}`;
}
