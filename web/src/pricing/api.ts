import { PricingResponseSchema, type PricingResponse } from '@linkz/shared';
import { apiFetch } from '../common/api';

// Public endpoint — NO getToken.
export async function fetchPricing(): Promise<PricingResponse> {
  const res = await apiFetch('/pricing');
  return PricingResponseSchema.parse(await res.json());
}
