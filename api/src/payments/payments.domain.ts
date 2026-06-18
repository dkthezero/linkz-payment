import type { ProviderEvent, PaymentOutcome } from './payments.ports';

// Authorization for payment creation is delegated to ReservationsService
// .getCheckoutReview, which owner-gates, asserts an active (non-expired)
// hold, joins the seat, and computes pricing in one call. There is no longer a
// standalone authorize* pure function here — the reservations call IS the
// authorization and throws NotFound/Forbidden/Gone/Conflict accordingly.

export function mapEvent(event: ProviderEvent): PaymentOutcome {
  if (event.type === 'checkout.session.completed' && event.isPaid) return 'succeeded';
  if (event.type === 'checkout.session.expired') return 'failed';
  if (event.type === 'checkout.session.async_payment_failed') return 'failed';
  if (event.type === 'payment_intent.payment_failed') return 'failed';
  if (event.type === 'test.checkout.session.completed' && event.isPaid) return 'succeeded';
  return 'ignore';
}