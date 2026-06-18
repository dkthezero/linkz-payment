import {
  CreatePaymentRequestSchema,
  CreatePaymentResponseSchema,
  PaymentSuccessRequestSchema,
  PaymentResponseSchema,
  type CreatePaymentResponse,
  type PaymentResponse,
} from '@linkz/shared';
import { apiFetch, type GetToken } from '../common/api';

export async function createPayment(
  reservationId: string,
  getToken: GetToken,
): Promise<CreatePaymentResponse> {
  const res = await apiFetch('/payments', {
    method: 'POST',
    body: CreatePaymentRequestSchema.parse({ reservationId }),
    getToken,
  });
  return CreatePaymentResponseSchema.parse(await res.json());
}

// Poll the payment status for a reservation (owner-gated). HT-3 maps
// checkout.session.expired → 'failed', so callers can distinguish failed
// holds from pending/succeeded.
export async function getPayment(
  reservationId: string,
  getToken: GetToken,
): Promise<PaymentResponse> {
  const res = await apiFetch(`/payments?reservationId=${encodeURIComponent(reservationId)}`, {
    getToken,
  });
  return PaymentResponseSchema.parse(await res.json());
}

export async function verifyPayment(reservationId: string, getToken: GetToken): Promise<void> {
  await apiFetch('/payments/verify', {
    method: 'POST',
    body: CreatePaymentRequestSchema.parse({ reservationId }),
    getToken,
  });
}

// Test-only: the test payment provider's success URL carries paymentId.
// The route is unregistered in production (HT-3 gates it to test+non-prod),
// so this must only be called when a paymentId is present.
export async function testSucceed(
  paymentId: string,
  reservationId: string,
  getToken: GetToken,
): Promise<void> {
  await apiFetch('/payments/test-succeed', {
    method: 'POST',
    body: PaymentSuccessRequestSchema.parse({ paymentId, reservationId }),
    getToken,
  });
}