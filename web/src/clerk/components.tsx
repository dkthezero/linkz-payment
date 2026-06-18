import { Show, type ParentProps } from 'solid-js';
import { useClerk } from './ClerkContext';

export function SignedIn(props: ParentProps) {
  const { auth } = useClerk();
  return <Show when={auth().isSignedIn}>{props.children}</Show>;
}

export function SignedOut(props: ParentProps) {
  const { auth } = useClerk();
  return <Show when={!auth().isSignedIn}>{props.children}</Show>;
}

/** "Sign in with Clerk" — opens Clerk's prebuilt sign-in modal. Disabled until Clerk + UI are loaded. */
export function SignInButton() {
  const { clerk, loaded } = useClerk();
  return (
    <button class="btn btn-primary" style={{ width: '100%', 'margin-bottom': '1rem' }} disabled={!loaded()} onClick={() => clerk.openSignIn()}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
        <polyline points="10 17 15 12 10 7" />
        <line x1="15" y1="12" x2="3" y2="12" />
      </svg>
      Sign in with Clerk
    </button>
  );
}

export function SignOutButton() {
  const { clerk } = useClerk();
  return (
    <button class="btn btn-secondary" onClick={() => clerk.signOut()}>
      Sign out
    </button>
  );
}