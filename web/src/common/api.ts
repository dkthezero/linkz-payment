import { webEnvSchema, type WebEnv } from '@linkz/config';
import { MeResponseSchema, type MeResponse } from '@linkz/shared';

export type GetToken = () => Promise<string | null>;

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

// Full web env (requires VITE_CLERK_PUBLISHABLE_KEY). Used by App.tsx.
// Cache the parse so repeated calls don't re-validate.
let webEnvCache: WebEnv | undefined;
export function loadWebEnv(): WebEnv {
  if (!webEnvCache) webEnvCache = webEnvSchema.parse(import.meta.env);
  return webEnvCache;
}

// apiFetch only needs VITE_API_URL. Use `.pick({ VITE_API_URL })` so the parse
// never throws — the full webEnvSchema requires VITE_CLERK_PUBLISHABLE_KEY
// (absent in the jsdom test env). Defaults to `/api` when unset.
let apiBaseCache: string | undefined;
function apiBase(): string {
  if (apiBaseCache === undefined) {
    apiBaseCache = webEnvSchema.pick({ VITE_API_URL: true }).parse(import.meta.env).VITE_API_URL;
  }
  return apiBaseCache;
}

export interface ApiFetchOptions {
  method?: string;
  body?: unknown; // JSON.stringify'd
  getToken?: GetToken;
}

export async function fetchMe(getToken: GetToken): Promise<MeResponse> {
  const res = await apiFetch('/me', { getToken });
  return MeResponseSchema.parse(await res.json());
}

// Low-level fetch against VITE_API_URL. Attaches JSON content-type + Bearer when
// getToken returns a non-null token. Throws ApiError(status, body, msg) on !ok.
// Returns the Response so callers parse with their own schema.
export async function apiFetch(path: string, opts?: ApiFetchOptions): Promise<Response> {
  const method = opts?.method ?? 'GET';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = opts?.getToken ? await opts.getToken() : null;
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const init: RequestInit = { method, headers };
  if (opts?.body !== undefined) init.body = JSON.stringify(opts.body);

  const res = await fetch(`${apiBase()}${path}`, init);
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    throw new ApiError(res.status, body, `request failed: ${res.status}`);
  }
  return res;
}