import { TicketResponseSchema, type TicketResponse } from '@linkz/shared';
import { apiFetch, type GetToken } from '../common/api';

export async function fetchTickets(
  reservationId: string,
  getToken: GetToken,
): Promise<TicketResponse[]> {
  const res = await apiFetch(`/tickets/${encodeURIComponent(reservationId)}`, { getToken });
  const raw = (await res.json()) as unknown[];
  return raw.map((item) => TicketResponseSchema.parse(item));
}
