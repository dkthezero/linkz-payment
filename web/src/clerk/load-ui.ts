import type { Clerk } from '@clerk/clerk-js';

/**
 * The Clerk UI constructor is shipped in a separate `@clerk/ui` browser bundle,
 * not in the `@clerk/clerk-js` npm package. Loading that bundle attaches it to
 * `window.__internal_ClerkUICtor`, which we then pass to `clerk.load({ ui })`
 * so prebuilt components (`openSignIn`, `mountSignIn`, …) can render.
 *
 * Type derived from the public `Clerk.load` signature so we never reach for `any`.
 */
type ClerkLoadOptions = NonNullable<Parameters<Clerk['load']>[0]>;
type ClerkUICtor = NonNullable<NonNullable<ClerkLoadOptions['ui']>['ClerkUI']>;

declare global {
  interface Window {
    __internal_ClerkUICtor?: ClerkUICtor;
  }
}

/** Derive the Clerk Frontend API domain from the publishable key (`pk_<env>_<base64>`). */
function deriveClerkDomain(publishableKey: string): string {
  const segment = publishableKey.split('_')[2];
  if (!segment) throw new Error('Invalid Clerk publishable key: missing domain segment');
  return atob(segment).slice(0, -1);
}

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load Clerk UI bundle from ${src}`));
    document.head.appendChild(script);
  });
}

/**
 * Load the `@clerk/ui` browser bundle for the instance behind `publishableKey`
 * and resolve with the UI constructor it attaches to `window`.
 */
export async function loadClerkUI(publishableKey: string): Promise<ClerkUICtor> {
  const domain = deriveClerkDomain(publishableKey);
  await injectScript(`https://${domain}/npm/@clerk/ui@1/dist/ui.browser.js`);
  const ctor = window.__internal_ClerkUICtor;
  if (!ctor) throw new Error('Clerk UI bundle loaded but did not expose __internal_ClerkUICtor');
  return ctor;
}

export type { ClerkUICtor };