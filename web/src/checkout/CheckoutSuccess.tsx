import { createEffect, createSignal, onCleanup, Show, For, type Component } from 'solid-js';
import { A, useSearchParams } from '@solidjs/router';
import { useClerk } from '../clerk/ClerkContext';
import {
  ApiError,
  fetchInvoice,
  fetchPaymentByReservation,
  fetchReservation,
  fetchTickets,
  testSucceed,
  verifyPayment,
} from '../api/client';
import type { InvoiceResponse, TicketResponse } from '@linkz/shared';

type SuccessState =
  | { kind: 'loading' }
  | { kind: 'pending' }
  | { kind: 'ticket'; tickets: TicketResponse[]; invoice: InvoiceResponse }
  | { kind: 'failed' }
  | { kind: 'expired' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string };

const VERIFY_AFTER_ATTEMPTS = 15;
const POLL_INTERVAL_MS = 5000;

const formatPrice = (cents: number, currency: string) =>
  `$${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
const shortId = (id: string) => id.slice(0, 8).toUpperCase();

export const CheckoutSuccess: Component = () => {
  const [searchParams] = useSearchParams();
  const { auth, loaded } = useClerk();

  const reservationId = () => searchParams.reservationId ?? '';
  const paymentId = () => searchParams.paymentId ?? '';

  const [token, setToken] = createSignal<string | null>(null);
  const [ready, setReady] = createSignal(false);
  const [state, setState] = createSignal<SuccessState>({ kind: 'loading' });
  const [attempts, setAttempts] = createSignal(0);
  const [verifyTriggered, setVerifyTriggered] = createSignal(false);
  const [holdExpiresAt, setHoldExpiresAt] = createSignal<Date | null>(null);

  createEffect(() => {
    if (!loaded()) return;
    auth()
      .getToken()
      .then((t) => {
        setToken(t);
        setReady(true);
      })
      .catch(() => {
        setState({ kind: 'error', message: 'Could not restore your session.' });
      });
  });

  const getToken = () => Promise.resolve(token());

  // Fetch reservation once on startup to get the hold expiry time and detect
  // if the reservation is already in a terminal state (expired / refunded).
  createEffect(() => {
    if (!ready()) return;
    const rid = reservationId();
    if (!rid) return;
    fetchReservation(rid, getToken)
      .then((res) => {
        setHoldExpiresAt(res.expiresAt ? new Date(res.expiresAt) : null);
        if (res.status === 'expired' || res.status === 'refunded') {
          setState({ kind: 'expired' });
        }
      })
      .catch(() => { /* non-fatal — expiry check is best-effort */ });
  });

  async function resolveOnce(): Promise<void> {
    const rid = reservationId();
    if (!rid) {
      setState({ kind: 'missing' });
      return;
    }

    const pid = paymentId();
    if (pid) {
      try {
        await testSucceed(pid, rid, getToken);
      } catch {
        // test-mode only, non-fatal
      }
    }

    try {
      const payment = await fetchPaymentByReservation(rid, getToken);

      if (payment.status === 'succeeded') {
        try {
          const [tickets, invoice] = await Promise.all([
            fetchTickets(rid, getToken),
            fetchInvoice(rid, getToken),
          ]);
          setState({ kind: 'ticket', tickets, invoice });
        } catch (artifactErr) {
          if (artifactErr instanceof ApiError && artifactErr.status === 404) {
            setState({ kind: 'pending' });
          } else {
            throw artifactErr;
          }
        }
        return;
      }

      if (payment.status === 'failed' || payment.status === 'refunded') {
        setState({ kind: 'failed' });
        return;
      }

      setState({ kind: 'pending' });
    } catch (e) {
      const message =
        e instanceof ApiError
          ? e.status === 404
            ? "We couldn't find that reservation."
            : `Payment could not be completed: ${e.message}`
          : `Payment could not be completed: ${String(e)}`;
      setState({ kind: 'error', message });
    }
  }

  createEffect(() => {
    if (!ready()) return;
    resolveOnce();
  });

  // Poll every 5 s while pending. Silently triggers server-side Stripe pull
  // after 15 attempts (~75 s). Stops when the hold expires.
  createEffect(() => {
    if (state().kind !== 'pending') return;

    const expiry = holdExpiresAt();
    if (expiry && new Date() > expiry) {
      setState({ kind: 'expired' });
      return;
    }

    const id = setTimeout(async () => {
      const attempt = attempts() + 1;
      setAttempts(attempt);

      if (attempt >= VERIFY_AFTER_ATTEMPTS && !verifyTriggered()) {
        setVerifyTriggered(true);
        try {
          await verifyPayment(reservationId(), getToken);
        } catch {
          // best-effort: keep polling even if verify call fails
        }
      }

      await resolveOnce();
    }, POLL_INTERVAL_MS);

    onCleanup(() => clearTimeout(id));
  });

  return (
    <main style={{ display: 'grid', 'place-items': 'center' }}>
      <div class="card" style={{ width: '100%', 'max-width': '640px' }}>
        <Show when={state().kind === 'loading'}>
          <p class="page-subtitle">Confirming your payment…</p>
        </Show>

        <Show when={state().kind === 'pending'}>
          <p class="page-subtitle">Payment is being verified.</p>
          <p style={{ 'font-size': '0.875rem', color: 'var(--gray-500)', 'margin-top': '0.5rem' }}>
            Do not make another payment. This page will update automatically.
          </p>
        </Show>

        <Show when={state().kind === 'expired'}>
          <p style={{ color: 'var(--danger-500)' }}>
            Your reservation expired while we were verifying your payment.
          </p>
          <p style={{ 'font-size': '0.875rem', color: 'var(--gray-500)', 'margin-top': '0.5rem' }}>
            If your card was charged, a refund will be processed automatically. No action needed.
          </p>
          <A href="/" class="btn btn-secondary" style={{ 'margin-top': '1rem' }}>← Back to seat map</A>
        </Show>

        <Show when={state().kind === 'error'}>
          <p style={{ color: 'var(--danger-500)' }}>{(state() as { kind: 'error'; message: string }).message}</p>
          <A href="/" class="btn btn-secondary" style={{ 'margin-top': '1rem' }}>← Back to seat map</A>
        </Show>

        <Show when={state().kind === 'missing'}>
          <p style={{ color: 'var(--danger-500)' }}>No reservation id was provided.</p>
          <A href="/" class="btn btn-secondary" style={{ 'margin-top': '1rem' }}>← Back to seat map</A>
        </Show>

        <Show when={state().kind === 'failed'}>
          <p style={{ color: 'var(--danger-500)' }}>
            Your hold expired or the payment failed. Please pick seats again.
          </p>
          <A href="/" class="btn btn-primary" style={{ display: 'inline-block', 'margin-top': '0.5rem' }}>
            Back to seats
          </A>
        </Show>

        <Show when={state().kind === 'ticket' ? state() : null}>
          {(s) => {
            const { tickets, invoice } = s() as {
              kind: 'ticket';
              tickets: TicketResponse[];
              invoice: InvoiceResponse;
            };
            const rid = reservationId();
            return (
              <div data-testid="ticket">
                <div class="card success-card" style={{ 'margin-bottom': '1.5rem' }}>
                  <div class="success-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  </div>
                  <h1 class="page-title" style={{ 'margin-bottom': '0.25rem' }}>Reservation confirmed</h1>
                  <p class="page-subtitle" style={{ margin: 0 }}>Payment received. Your seats are now confirmed.</p>
                </div>

                <div class="card" style={{ 'margin-bottom': '1.5rem' }}>
                  <h2 style={{ 'margin-top': 0, 'font-size': '1.125rem' }}>Reservation #{shortId(rid)}</h2>
                  <div class="detail-grid">
                    <div>
                      <strong>Seats</strong>
                      <span>{tickets.length} seat{tickets.length === 1 ? '' : 's'}</span>
                    </div>
                    <div>
                      <strong>Invoice</strong>
                      <span>{invoice.number}</span>
                    </div>
                    <div>
                      <strong>Total paid</strong>
                      <span>{formatPrice(invoice.amount, invoice.currency)}</span>
                    </div>
                    <div>
                      <strong>Status</strong>
                      <span style={{ color: 'var(--success-700)' }}>Confirmed</span>
                    </div>
                  </div>

                  <For each={tickets}>
                    {(ticket) => (
                      <div class="ticket">
                        <Show when={ticket.qrCode}>
                          <div class="qr" aria-label="QR code placeholder" />
                        </Show>
                        <p style={{ margin: '0 0 0.5rem', 'font-weight': 700, 'text-align': 'center' }}>E-Ticket</p>
                        <p style={{ margin: 0, 'font-size': '0.875rem', color: 'var(--gray-500)', 'text-align': 'center' }}>
                          Present this QR code at the entrance. Serial <strong>{ticket.serial}</strong>.
                        </p>
                      </div>
                    )}
                  </For>
                </div>

                <div style={{ display: 'grid', gap: '0.75rem', 'margin-top': '1.5rem' }}>
                  <Show
                    when={invoice.pdfUrl}
                    fallback={
                      <button class="btn btn-secondary" disabled>
                        Invoice unavailable
                      </button>
                    }
                  >
                    <a
                      href={invoice.pdfUrl as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="btn btn-secondary"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                      </svg>
                      Download invoice ({invoice.number})
                    </a>
                  </Show>
                  <A href="/" class="btn btn-primary">
                    Make another reservation
                  </A>
                </div>
              </div>
            );
          }}
        </Show>
      </div>
    </main>
  );
};
