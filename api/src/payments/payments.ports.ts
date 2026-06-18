export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'refunded';
export type PaymentOutcome = 'succeeded' | 'failed' | 'ignore';

// Provider-agnostic, normalized webhook event (Stripe specifics live in the adapter).
export interface ProviderEvent {
  id: string;
  type: string;
  paymentId: string | null; // from provider metadata
  isPaid: boolean; // session payment_status === 'paid'
  raw: unknown; // original event, stored in the ledger payload
}

export interface PaymentRow {
  id: string;
  reservationId: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  idempotencyKey: string;
  providerRef: string | null;
}

export interface NewPayment {
  reservationId: string;
  provider: string;
  providerRef: string | null;
  idempotencyKey: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
}

export interface PaymentProviderPort {
  createCheckoutSession(input: {
    paymentId: string;
    reservationId: string;
    amount: number;
    currency: string;
    idempotencyKey: string;
  }): Promise<{ providerRef: string; checkoutUrl: string }>;
  constructEvent(rawBody: Buffer | string, signature: string): ProviderEvent;
  /** Pull the session status from the provider. Returns a normalised event when
   *  the session is paid, null when not yet settled. Used when the push webhook
   *  has not arrived within the expected window. */
  fetchSessionEvent(providerRef: string): Promise<ProviderEvent | null>;
}

export interface PaymentsRepositoryPort {
  findById(paymentId: string): Promise<PaymentRow | null>;
  findByReservation(reservationId: string): Promise<PaymentRow | null>;
  insertPending(input: NewPayment): Promise<PaymentRow>;
  updateProviderRef(paymentId: string, providerRef: string): Promise<void>;
  settle(paymentId: string, outcome: 'succeeded' | 'failed', event: ProviderEvent): Promise<boolean>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
export const PAYMENTS_REPOSITORY = Symbol('PAYMENTS_REPOSITORY');
