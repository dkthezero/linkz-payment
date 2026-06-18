import type { Clerk } from '@clerk/clerk-js';

export interface MeResponse {
  appUserId: string;
  clerkUserId: string;
  email: string;
  name: string;
}

export interface AuthState {
  isSignedIn: boolean;
  userId: string | null;
  name: string | null;
  getToken: () => Promise<string | null>;
}

export function deriveAuth(clerk: Clerk): AuthState {
  const user = clerk.user;
  const name = user ? [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || null : null;
  return {
    isSignedIn: !!clerk.isSignedIn,
    userId: user?.id ?? null,
    name,
    getToken: () => (clerk.session ? clerk.session.getToken() : Promise.resolve(null)),
  };
}

export async function fetchMe(getToken: () => Promise<string | null>): Promise<MeResponse> {
  const token = await getToken();
  if (!token) throw new Error('Not authenticated');
  const res = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`me request failed: ${res.status}`);
  return res.json();
}