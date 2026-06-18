import { Show, type Component, type ParentComponent } from 'solid-js';
import type { WebEnv } from '@linkz/config';
import { A, Router, Route } from '@solidjs/router';
import { ClerkProvider, TestClerkProvider, useClerk } from './clerk/ClerkContext';
import { SignedIn, SignOutButton } from './clerk/components';
import { SeatMap } from './seats/SeatMap';
import { CheckoutPage } from './checkout/CheckoutPage';
import { CheckoutSuccess } from './checkout/CheckoutSuccess';
import { CheckoutCancel } from './checkout/CheckoutCancel';
import { loadWebEnv } from './common/api';

const Logo = () => (
  <A href="/" class="logo">
    <span class="logo-mark">L</span>
    <span>LinkZ</span>
  </A>
);

const UserChip: Component = () => {
  const { auth } = useClerk();
  const initials = () => {
    const name = auth().name ?? '';
    return name
      .split(' ')
      .map((p) => p[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?';
  };

  return (
    <div class="user-chip">
      <Show when={auth().name}>
        <span>{auth().name}</span>
      </Show>
      <div class="avatar">{initials()}</div>
      <SignOutButton />
    </div>
  );
};

const Home: Component = () => {
  const { error } = useClerk();

  // The seat map + pricing are public (no auth required to browse). Sign-in is
  // only needed to hold seats / pay, and that CTA lives in the seat map's right
  // column — so we always render SeatMap here regardless of auth state.
  return (
    <Show when={!error()} fallback={
      <main style={{ display: 'grid', 'place-items': 'center' }}>
        <div class="card" style={{ width: '100%', 'max-width': '420px', 'text-align': 'center', color: 'var(--danger-500)' }}>
          <h1 class="page-title">Couldn't load sign-in</h1>
          <p class="page-subtitle">{error()}</p>
        </div>
      </main>
    }>
      <SeatMap />
    </Show>
  );
};

const AppShell: ParentComponent = (props) => {
  return (
    <div class="page">
      <header>
        <Logo />
        <SignedIn>
          <UserChip />
        </SignedIn>
      </header>

      {props.children}

      <footer>LinkZ — Seat Reservation Platform</footer>
    </div>
  );
};

function isBypassAuth(): boolean {
  try {
    return localStorage.getItem('linkz:bypass-auth') === 'true';
  } catch {
    return false;
  }
}

const App: Component = () => {
  const routes = (
    <>
      <Route path="/" component={Home} />
      <Route path="/checkout/:reservationId" component={CheckoutPage} />
      <Route path="/checkout/success" component={CheckoutSuccess} />
      <Route path="/checkout/cancel" component={CheckoutCancel} />
    </>
  );

  if (isBypassAuth()) {
    return (
      <TestClerkProvider>
        <Router root={AppShell}>{routes}</Router>
      </TestClerkProvider>
    );
  }

  let env: WebEnv;
  try {
    env = loadWebEnv();
  } catch {
    return <main style={{ color: 'var(--danger-500)', padding: '2rem' }}>Missing VITE_CLERK_PUBLISHABLE_KEY</main>;
  }

  return (
    <ClerkProvider publishableKey={env.VITE_CLERK_PUBLISHABLE_KEY}>
      <Router root={AppShell}>{routes}</Router>
    </ClerkProvider>
  );
};

export default App;
