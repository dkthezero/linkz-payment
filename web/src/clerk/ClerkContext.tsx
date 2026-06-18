import { createContext, useContext, createSignal, onMount, onCleanup, type ParentProps } from 'solid-js';
import { Clerk } from '@clerk/clerk-js';
import { deriveAuth, type AuthState } from './auth';
import { loadClerkUI } from './load-ui';

interface ClerkCtxValue {
  clerk: Clerk;
  auth: () => AuthState;
  /** True once `clerk.load()` has resolved and the UI bundle is wired up. */
  loaded: () => boolean;
  /** Non-null if Clerk failed to load (bad key, UI bundle unreachable, …). */
  error: () => string | null;
}

const ClerkCtx = createContext<ClerkCtxValue>();

const initialAuth: AuthState = {
  isSignedIn: false,
  userId: null,
  name: null,
  getToken: () => Promise.resolve(null),
};

export function ClerkProvider(props: ParentProps<{ publishableKey: string }>) {
  const clerk = new Clerk(props.publishableKey);
  const [auth, setAuth] = createSignal<AuthState>(initialAuth);
  const [loaded, setLoaded] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const sync = () => setAuth(deriveAuth(clerk));
  let unsubscribe: (() => void) | undefined;

  onMount(async () => {
    try {
      // The prebuilt Clerk UI (sign-in modal, etc.) lives in the @clerk/ui
      // browser bundle, not in @clerk/clerk-js. Load it and pass its ctor to
      // clerk.load() — otherwise openSignIn() throws "not loaded with Ui components".
      const ClerkUI = await loadClerkUI(props.publishableKey);
      await clerk.load({ ui: { ClerkUI } });
      sync();
      unsubscribe = clerk.addListener(sync);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  });

  onCleanup(() => unsubscribe?.());

  return (
    <ClerkCtx.Provider value={{ clerk, auth, loaded, error }}>{props.children}</ClerkCtx.Provider>
  );
}

export function useClerk(): ClerkCtxValue {
  const ctx = useContext(ClerkCtx);
  if (!ctx) throw new Error('useClerk must be used within ClerkProvider');
  return ctx;
}

const testAuth: AuthState = {
  isSignedIn: true,
  userId: 'test_user',
  name: 'Test User',
  getToken: () => Promise.resolve('test_token'),
};

const testClerk = {
  openSignIn: () => undefined,
  signOut: () => Promise.resolve(),
} as unknown as Clerk;

/** Test-only provider that bypasses real Clerk loading. Enabled via VITE_BYPASS_AUTH. */
export function TestClerkProvider(props: ParentProps) {
  return (
    <ClerkCtx.Provider
      value={{
        clerk: testClerk,
        auth: () => testAuth,
        loaded: () => true,
        error: () => null,
      }}
    >
      {props.children}
    </ClerkCtx.Provider>
  );
}