import {
  CreateReservationRequestSchema,
  CreateReservationResponseSchema,
  CheckoutReviewResponseSchema,
  ReservationListResponseSchema,
  ReservationResponseSchema,
  type CreateReservationResponse,
  type CheckoutReviewResponse,
  type ReservationResponse,
} from '@linkz/shared';
import { apiFetch, type GetToken } from '../common/api';

export async function createReservation(
  seatIds: string[],
  getToken: GetToken,
): Promise<CreateReservationResponse> {
  const res = await apiFetch('/reservations', {
    method: 'POST',
    body: CreateReservationRequestSchema.parse({ seatIds }),
    getToken,
  });
  return CreateReservationResponseSchema.parse(await res.json());
}

export async function fetchCheckoutReview(
  reservationId: string,
  getToken: GetToken,
): Promise<CheckoutReviewResponse> {
  const res = await apiFetch(`/reservations/${encodeURIComponent(reservationId)}/checkout`, { getToken });
  return CheckoutReviewResponseSchema.parse(await res.json());
}

/** List the signed-in user's reservations (owner-gated). Used to resume an
 *  in-progress checkout when the seat map loads with a live held reservation. */
export async function fetchMyReservations(getToken: GetToken): Promise<ReservationResponse[]> {
  const res = await apiFetch('/reservations', { getToken });
  return ReservationListResponseSchema.parse(await res.json());
}

/** Release (cancel) a held reservation — DELETE /reservations/:id. Used by the
 *  change-seats flow to free the seats before re-selecting them. */
export async function cancelReservation(reservationId: string, getToken: GetToken): Promise<void> {
  await apiFetch(`/reservations/${encodeURIComponent(reservationId)}`, { method: 'DELETE', getToken });
}

export async function fetchReservation(reservationId: string, getToken: GetToken): Promise<ReservationResponse> {
  const res = await apiFetch(`/reservations/${encodeURIComponent(reservationId)}`, { getToken });
  return ReservationResponseSchema.parse(await res.json());
}
