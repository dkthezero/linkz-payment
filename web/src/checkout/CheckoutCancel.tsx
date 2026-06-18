import { Show, type Component } from 'solid-js';
import { A, useSearchParams } from '@solidjs/router';

export const CheckoutCancel: Component = () => {
  const [searchParams] = useSearchParams();
  const reservationId = () => searchParams.reservationId;

  return (
    <main style={{ display: 'grid', 'place-items': 'center' }}>
      <div class="card" style={{ width: '100%', 'max-width': '640px' }}>
        <div class="card" style={{ 'margin-bottom': '1.5rem', 'text-align': 'center' }}>
          <h1 class="page-title" style={{ color: 'var(--danger-500)' }}>Payment cancelled</h1>
          <p class="page-subtitle" style={{ margin: 0 }}>
            You returned from the payment provider without completing the charge.
          </p>
        </div>

        <p style={{ 'margin-bottom': '1.5rem' }}>
          Your seat hold is still active. You can retry payment or choose different seats.
        </p>

        <div style={{ display: 'flex', gap: '1rem', 'flex-wrap': 'wrap' }}>
          <A href="/" class="btn btn-secondary">← Change seats</A>
          <Show when={reservationId()}>
            {(id) => (
              <A
                href={`/checkout/${id()}`}
                class="btn btn-primary"
                style={{ flex: 1, 'min-width': '180px' }}
              >
                Retry payment
              </A>
            )}
          </Show>
        </div>
      </div>
    </main>
  );
};
