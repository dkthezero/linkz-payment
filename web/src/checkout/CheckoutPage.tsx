import { createEffect, createSignal, onCleanup, Show, For, type Component } from 'solid-js';
import type { CheckoutReviewResponse } from '@linkz/shared';
import { A, useNavigate, useParams } from '@solidjs/router';
import { ApiError, fetchCheckoutReview, createPayment } from '../api/client';
import { useClerk } from '../clerk/ClerkContext';
import { setPendingRelease } from '../reservations/pending-release';
import { toPendingRelease } from './departure';

const formatPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const pad2 = (n: number) => String(n).padStart(2, '0');
const formatCountdown = (ms: number) => {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${pad2(m)}:${pad2(s)}`;
};

export const CheckoutPage: Component = () => {
  const params = useParams();
  const navigate = useNavigate();
  const { auth } = useClerk();
  const getToken = () => auth().getToken();

  const [payBusy, setPayBusy] = createSignal(false);
  const [payError, setPayError] = createSignal<string | null>(null);

  const [reviewLoading, setReviewLoading] = createSignal(true);
  const [reviewError, setReviewError] = createSignal<unknown>(null);
  const [review, setReview] = createSignal<CheckoutReviewResponse | null>(null);
  const [remainingMs, setRemainingMs] = createSignal(0);

  createEffect(() => {
    const reservationId = params.reservationId;
    setReviewLoading(true);
    setReviewError(null);
    setPayError(null);
    console.debug('[checkout] loading review for', reservationId);
    fetchCheckoutReview(reservationId, getToken)
      .then((r) => {
        console.debug('[checkout] review loaded', r.reservation.id, `${r.seats.length} seat(s)`, r.pricing);
        setReview(r);
      })
      .catch((e) => {
        console.debug('[checkout] review error', e);
        setReviewError(e);
      })
      .finally(() => setReviewLoading(false));
  });

  createEffect(() => {
    const expiresAt = review()?.reservation.expiresAt;
    if (!expiresAt) {
      setRemainingMs(0);
      return;
    }
    const target = new Date(expiresAt).getTime();
    const tick = () => {
      const r = Math.max(0, target - Date.now());
      setRemainingMs(r);
      if (r === 0) clearInterval(id);
    };
    tick();
    const id = setInterval(tick, 1000);
    onCleanup(() => clearInterval(id));
  });

  const isExpired = () => remainingMs() <= 0;

  const onPay = async () => {
    if (isExpired()) return;
    const reservationId = params.reservationId;
    console.debug('[checkout] starting payment for', reservationId);
    setPayBusy(true);
    setPayError(null);
    try {
      const { checkoutUrl } = await createPayment(reservationId, getToken);
      console.debug('[checkout] redirecting to payment provider');
      window.location.href = checkoutUrl;
    } catch (e) {
      console.debug('[checkout] payment creation failed', e);
      if (e instanceof ApiError && e.status === 410) {
        setPayError('Your hold has expired. Please choose another seat.');
      } else if (e instanceof ApiError && e.status === 409) {
        setPayError('This reservation is already paid or no longer held.');
      } else if (e instanceof ApiError && e.status === 404) {
        setPayError('Reservation not found.');
      } else if (e instanceof ApiError && e.status === 403) {
        setPayError('You do not own this reservation.');
      } else {
        setPayError(e instanceof Error ? e.message : String(e));
      }
      setPayBusy(false);
    }
  };

  // Leaving checkout to change seats — whether via the button or the browser
  // Back button — must free the held seats so they're selectable again on the
  // seat map. We stash a pending-release intent in sessionStorage; the seat
  // map's entry effect consumes it, cancels the reservation, and re-selects the
  // seats that are still available.
  const leaveToChangeSeats = () => {
    const r = review();
    if (r) setPendingRelease(toPendingRelease(r));
    navigate('/');
  };

  createEffect(() => {
    const r = review();
    if (!r) return;
    const onPop = () => setPendingRelease(toPendingRelease(r));
    window.addEventListener('popstate', onPop);
    onCleanup(() => window.removeEventListener('popstate', onPop));
  });

  return (
    <main style={{ 'max-width': '640px' }}>
      <Show when={reviewLoading()}>
        <p class="page-subtitle">Loading your reservation…</p>
      </Show>

      <Show when={!!reviewError()}>
        <div class="card" style={{ 'margin-bottom': '1.5rem' }}>
          <h1 class="page-title">Checkout unavailable</h1>
          <p data-testid="checkout-error" style={{ color: 'var(--danger-500)' }}>
            {reviewError() instanceof ApiError && reviewError().status === 410
              ? 'Your hold has expired. Please choose another seat.'
              : reviewError() instanceof ApiError && reviewError().status === 404
                ? 'Reservation not found.'
                : reviewError() instanceof ApiError && reviewError().status === 403
                  ? 'You do not own this reservation.'
                  : reviewError() instanceof Error
                    ? reviewError().message
                    : String(reviewError())}
          </p>
          <A href="/" class="btn btn-secondary" style={{ 'margin-top': '1rem' }}>← Back to seat map</A>
        </div>
      </Show>

      <Show when={review()}>
        {(data) => {
          const r = data();
          const totalLabel = formatPrice(r.pricing.total);
          const seatLabels = r.seats.map((s) => s.label).join(', ');
          const seatCount = r.seats.length;
          return (
            <>
              <h1 class="page-title">Review your reservation</h1>
              <p class="page-subtitle">Confirm the details before we redirect you to the payment provider.</p>

              <div class="card" style={{ 'margin-bottom': '1.5rem' }}>
                <div
                  style={{
                    display: 'flex',
                    'justify-content': 'space-between',
                    'align-items': 'flex-start',
                    'margin-bottom': '1rem',
                  }}
                >
                  <div>
                    <h2 style={{ margin: '0 0 0.25rem', 'font-size': '1.125rem' }}>
                      {seatCount === 1 ? `Seat ${seatLabels}` : `Seats ${seatLabels}`}
                    </h2>
                    <For each={r.seats}>
                      {(seat) => (
                        <p style={{ margin: 0, color: 'var(--gray-500)', 'font-size': '0.875rem' }}>
                          {seat.label} — {seat.descriptor}
                        </p>
                      )}
                    </For>
                  </div>
                  <Show
                    when={!isExpired()}
                    fallback={<span class="badge badge-gray">Expired</span>}
                  >
                    <span class="badge badge-green" title="Time left until your hold expires">
                      Held · {formatCountdown(remainingMs())}
                    </span>
                  </Show>
                </div>

                <div class="summary-row"><span>Seat price</span><strong>{formatPrice(r.pricing.seatPrice)}</strong></div>
                <div class="summary-row"><span>Service fee</span><strong>{formatPrice(r.pricing.serviceFee)}</strong></div>
                <div class="summary-row"><span>Total due</span><span style={{ color: 'var(--brand-600)' }}>{totalLabel}</span></div>

                <Show
                  when={!isExpired()}
                  fallback={
                    <p style={{ 'margin-top': '1rem', color: 'var(--danger-500)' }}>
                      Your hold has expired. Please return to the seat map to pick again.
                    </p>
                  }
                >
                  <p style={{ 'margin-top': '1rem', 'font-size': '0.875rem', color: 'var(--gray-500)' }}>
                    Complete payment before the time runs out to keep your seats.
                  </p>
                </Show>
              </div>

              <div class="card" style={{ 'margin-bottom': '1.5rem' }}>
                <h2 style={{ 'margin-top': 0, 'font-size': '1.125rem' }}>Contact</h2>
                <div class="summary-row"><span>Email</span><strong>{r.contact.email}</strong></div>
                <div class="summary-row" style={{ 'border-bottom': 'none' }}>
                  <span>Payment method</span><strong>Hosted checkout</strong>
                </div>
              </div>

              <Show when={payError()}>
                <p data-testid="pay-error" style={{ color: 'var(--danger-500)', 'margin-bottom': '1rem' }}>{payError()}</p>
              </Show>

              <div style={{ display: 'flex', gap: '1rem', 'flex-wrap': 'wrap' }}>
                <button class="btn btn-secondary" onClick={leaveToChangeSeats}>← Change seats</button>
                <button
                  class="btn btn-primary"
                  style={{ flex: 1, 'min-width': '180px' }}
                  disabled={payBusy() || isExpired()}
                  onClick={onPay}
                >
                  {payBusy() ? 'Redirecting…' : isExpired() ? 'Hold expired' : `Pay ${totalLabel}`}
                </button>
              </div>
            </>
          );
        }}
      </Show>
    </main>
  );
};
