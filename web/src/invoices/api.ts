import { InvoiceResponseSchema, type InvoiceResponse } from '@linkz/shared';
import { apiFetch, type GetToken } from '../common/api';

// Fetch the saga-issued invoice for a reservation (owner-gated).
export async function fetchInvoice(
  reservationId: string,
  getToken: GetToken,
): Promise<InvoiceResponse> {
  const res = await apiFetch(`/invoices/${encodeURIComponent(reservationId)}`, { getToken });
  return InvoiceResponseSchema.parse(await res.json());
}