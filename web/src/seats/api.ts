import { SeatListResponseSchema, type SeatListResponse } from '@linkz/shared';
import { apiFetch } from '../common/api';

// Public endpoint — NO getToken. SeatsController is intentionally unauthenticated
// (browsing before sign-in).
export async function fetchSeats(): Promise<SeatListResponse> {
  const res = await apiFetch('/seats'); // no getToken — seats controller is public
  return SeatListResponseSchema.parse(await res.json());
}