import { createSignal, createResource, Show, For, createMemo, createEffect, type Component } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import type { SeatResponse } from '@linkz/shared';
import { ApiError, createReservation, cancelReservation, fetchMyReservations } from '../api/client';
import { useClerk } from '../clerk/ClerkContext';
import { SignInButton } from '../clerk/components';
import { fetchSeats } from './api';
import { fetchPricing } from '../pricing/api';
import { loadSelection, saveSelection, clearSelection } from './selection';
import { consumePendingRelease } from '../reservations/pending-release';
import { findLiveHold, reconcileSelection } from './resume';
import './SeatMap.css';

const formatPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export const SeatMap: Component = () => {
  const navigate = useNavigate();
  const { auth, clerk, loaded } = useClerk();
  const getToken = () => auth().getToken();
  const isSignedIn = () => auth().isSignedIn;

  const [seats, { refetch: refetchSeats }] = createResource(fetchSeats);
  const [pricing] = createResource(fetchPricing);
  // Seed from sessionStorage so a selection made before sign-in survives the
  // Google OAuth redirect (which reloads the SPA and would otherwise wipe it).
  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set(loadSelection()));
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const selectedSeats = createMemo(() => seats()?.filter((s) => selectedIds().has(s.id)) ?? []);
  const seatError = () => (typeof seats.error === 'function' ? seats.error() : seats.error);

  // On entry, decide between resuming an in-progress checkout and releasing a
  // reservation so the user can change seats. A `pending-release` flag (set by
  // the checkout page's "Change seats" button or browser Back) means we left
  // checkout deliberately: cancel the reservation, refetch seats, and keep the
  // seats that are still available selected. Without that flag, a signed-in user
  // with a live held reservation is bounced straight back to checkout. Runs once.
  const [entryChecked, setEntryChecked] = createSignal(false);
  createEffect(() => {
    if (!loaded() || entryChecked()) return;
    setEntryChecked(true);
    void runEntry();
  });

  const runEntry = async () => {
    const pending = consumePendingRelease();
    if (pending) {
      if (isSignedIn()) {
        try {
          await cancelReservation(pending.reservationId, getToken);
        } catch {
          // Stale intent (already expired/released/cancelled) — ignore; the
          // refetch below reflects whatever state the seat is actually in.
        }
        await refetchSeats();
        const reconciled = reconcileSelection(pending.seatIds, seats() ?? []);
        setSelectedIds(new Set(reconciled));
        saveSelection(reconciled);
      } else {
        setSelectedIds(new Set(pending.seatIds));
        saveSelection(pending.seatIds);
      }
      return;
    }
    if (isSignedIn()) {
      try {
        const mine = await fetchMyReservations(getToken);
        const live = findLiveHold(mine, new Date());
        if (live) navigate(`/checkout/${live.id}`);
      } catch {
        // Degrade to a normal browse — the seat map is still usable.
      }
    }
  };

  const toggleSeat = (seat: SeatResponse) => {
    // DEMO ONLY: only `held` seats are unselectable here. In production, paid
    // (confirmed) seats must also be disabled and rendered as booked — and the
    // backend must NOT free confirmed slots (see the TODO in
    // ReservationsService.hold / releaseConfirmedSeats). The demo frees
    // confirmed slots at hold time so the re-booking flow can be shown.
    // TODO(production): treat `confirmed` like `held` (disable + style as booked).
    if (seat.status === 'held' || busy()) return;
    console.debug('[seatmap] toggled', seat.label, seat.id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(seat.id)) next.delete(seat.id);
      else next.add(seat.id);
      saveSelection([...next]);
      return next;
    });
  };

  const totalSeatPrice = createMemo(() => selectedSeats().reduce((sum, s) => sum + s.price, 0));
  const totalPrice = createMemo(() => totalSeatPrice() + (pricing()?.serviceFee ?? 0));

  const onProceed = async () => {
    const ids = Array.from(selectedIds());
    if (ids.length === 0) return;
    setBusy(true);
    setError(null);
    console.debug('[seatmap] creating reservation for', ids);
    try {
      const { reservationId } = await createReservation(ids, getToken);
      console.debug('[seatmap] reservation created', reservationId);
      // The selection is consumed by the reservation; drop it so a back-button
      // return to the seat map doesn't restore a stale selection.
      clearSelection();
      navigate(`/checkout/${reservationId}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError('One or more selected seats were just taken. Please choose again.');
        await refetchSeats();
        setSelectedIds(new Set());
        clearSelection();
      } else if (e instanceof ApiError && e.status === 401) {
        setError('Sign in is required to reserve a seat.');
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
      console.debug('[seatmap] reservation failed', error());
    } finally {
      setBusy(false);
    }
  };

  // Signed-out users keep their selection across sign-in. Google OAuth is a
  // redirect flow — the tab navigates to Google and back, reloading the SPA and
  // wiping the in-memory signal — so the selection is mirrored to sessionStorage
  // (see toggleSeat) and re-seeded on mount (above), restoring it after sign-in.
  // Here we just open the Clerk sign-in; persistence handles the rest.
  const onSignInToReserve = () => {
    if (loaded()) clerk.openSignIn();
  };

  return (
    <main>
      <h1 class="page-title">Reserve your seats</h1>
      <p class="page-subtitle">
        Browse live availability and pricing — no sign-in needed to look. Sign in when you’re ready to hold seats and pay.
      </p>

      <Show when={error()}>
        <p style={{ color: 'var(--danger-500)', 'text-align': 'center' }}>{error()}</p>
      </Show>
      <Show when={busy()}>
        <div class="overlay">Reserving your seats…</div>
      </Show>

      <div class="split">
        <section>
          <div class="card">
            <div class="stage">STAGE</div>

            <div class="legend">
              <div class="legend-item"><span class="swatch" style={{ background: '#fff' }}></span> Available</div>
              <div class="legend-item"><span class="swatch" style={{ background: 'var(--brand-50)', 'border-color': 'var(--brand-600)' }}></span> Selected</div>
              <div class="legend-item"><span class="swatch" style={{ background: 'var(--gray-50)' }}></span> Held</div>
            </div>

            <Show when={!!seatError()}>
              <p style={{ color: 'var(--danger-500)' }}>Could not load seats: {String(seatError())}</p>
            </Show>

            <div class="seat-grid" role="group" aria-label="Seat selection">
              <For each={seats()}>
                {(seat) => {
                  const isSelected = () => selectedIds().has(seat.id);
                  const className = () => `seat ${seat.status}${isSelected() ? ' selected' : ''}`;
                  return (
                    <button
                      class={className()}
                      disabled={seat.status === 'held' || busy()}
                      aria-label={`Seat ${seat.label} ${seat.status === 'held' ? 'held' : formatPrice(seat.price)}`}
                      aria-pressed={isSelected()}
                      onClick={() => toggleSeat(seat)}
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 10V7a5 5 0 1 1 10 0v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1Z"/></svg>
                      <span class="seat-label">{seat.label}</span>
                      <span class="seat-price">{seat.status === 'held' ? '—' : formatPrice(seat.price)}</span>
                    </button>
                  );
                }}
              </For>
            </div>

            <p class="pricing-note">
              Prices shown per seat. A{' '}
              <Show when={pricing()} fallback={<strong>…</strong>}>
                {(p) => <strong>{formatPrice(p().serviceFee)}</strong>}
              </Show>{' '}
              service fee is added once per reservation (group pricing).
            </p>
          </div>
        </section>

        <aside>
          <div class="card" style={{ position: 'sticky', top: '5rem' }}>
            <Show
              when={isSignedIn()}
              fallback={
                <>
                  <div class="logo-mark" style={{ width: '3rem', height: '3rem', margin: '0 auto 1rem', 'font-size': '1.25rem' }}>L</div>
                  <h2 class="page-title" style={{ 'font-size': '1.25rem' }}>Reserve your seat</h2>
                  <p class="page-subtitle" style={{ 'margin-bottom': '1.5rem' }}>
                    Sign in to hold your seats and pay for your group.
                  </p>

                  <Show when={selectedSeats().length > 0}>
                    <For each={selectedSeats()}>
                      {(seat) => (
                        <div class="summary-row">
                          <span>{seat.label}</span>
                          <strong>{formatPrice(seat.price)}</strong>
                        </div>
                      )}
                    </For>
                    <div class="summary-row">
                      <span>Service fee</span>
                      <Show when={pricing()} fallback={<strong>…</strong>}>
                        {(p) => <strong>{formatPrice(p().serviceFee)}</strong>}
                      </Show>
                    </div>
                    <div class="summary-row">
                      <span>Total</span>
                      <span style={{ color: 'var(--brand-600)' }}>{formatPrice(totalPrice())}</span>
                    </div>
                    <button
                      class="btn btn-primary"
                      style={{ width: '100%', 'margin-top': '0.5rem', 'margin-bottom': '1rem' }}
                      disabled={!loaded()}
                      onClick={onSignInToReserve}
                    >
                      Sign in to reserve
                    </button>
                  </Show>

                  <Show when={selectedSeats().length === 0}>
                    <SignInButton />
                  </Show>

                  <p style={{ 'font-size': '0.75rem', color: 'var(--gray-400)' }}>
                    Mock sign-in for the assignment prototype.
                  </p>
                </>
              }
            >
              <h2 style={{ 'margin-top': 0, 'font-size': '1.125rem' }}>Your selection</h2>
              <Show
                when={selectedSeats().length > 0}
                fallback={<p class="page-subtitle">Select one or more seats to continue.</p>}
              >
                <For each={selectedSeats()}>
                  {(seat) => (
                    <div class="summary-row">
                      <span>{seat.label}</span>
                      <strong>{formatPrice(seat.price)}</strong>
                    </div>
                  )}
                </For>
                <div class="summary-row">
                  <span>Service fee</span>
                  <Show when={pricing()} fallback={<strong>…</strong>}>
                    {(p) => <strong>{formatPrice(p().serviceFee)}</strong>}
                  </Show>
                </div>
                <div class="summary-row">
                  <span>Total</span>
                  <span style={{ color: 'var(--brand-600)' }}>{formatPrice(totalPrice())}</span>
                </div>
                <button
                  class="btn btn-primary"
                  style={{ width: '100%', 'margin-top': '0.5rem' }}
                  disabled={busy()}
                  onClick={onProceed}
                >
                  Proceed to payment
                </button>
              </Show>
            </Show>
          </div>
        </aside>
      </div>
    </main>
  );
};
