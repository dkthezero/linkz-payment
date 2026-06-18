// Centralized, authed API client for the web SPA.
//
// Each domain helper lives next to its feature (seats/pricing are public and
// stay where they are). This barrel re-exports the authed helpers plus the
// shared ApiError type so checkout pages have a single import surface.
export { ApiError } from '../common/api';
export type { GetToken } from '../common/api';
export { fetchMe } from '../common/api';

export { createReservation, fetchCheckoutReview, fetchMyReservations, cancelReservation, fetchReservation } from '../reservations/api';
export { createPayment, getPayment as fetchPaymentByReservation, verifyPayment, testSucceed } from '../payments/api';
export { fetchTickets } from '../tickets/api';
export { fetchInvoice } from '../invoices/api';
