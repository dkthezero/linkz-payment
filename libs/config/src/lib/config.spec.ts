import { describe, it, expect } from 'vitest';
import { apiEnvSchema, webEnvSchema } from './config.js';

describe('apiEnvSchema', () => {
  const base = {
    DATABASE_URL: 'postgres://u:p@localhost:18602/linkz',
    CLERK_SECRET_KEY: 'sk_test_x',
    STRIPE_SECRET_KEY: 'sk_stripe_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
  };
  it('parses a valid env with defaults', () => {
    const out = apiEnvSchema.parse(base);
    expect(out.PORT).toBe(18600);
    expect(out.CORS_ORIGIN).toBe('http://localhost:18601');
    expect(out.NODE_ENV).toBe('development');
    expect(out.STRIPE_SUCCESS_URL).toBe('http://localhost:18601/checkout/success');
  });
  it('rejects missing DATABASE_URL', () => {
    const { DATABASE_URL: _omit, ...rest } = base;
    expect(() => apiEnvSchema.parse(rest)).toThrow();
  });
  it('rejects missing CLERK_SECRET_KEY', () => {
    const { CLERK_SECRET_KEY: _omit, ...rest } = base;
    expect(() => apiEnvSchema.parse(rest)).toThrow();
  });
  it('rejects missing STRIPE_SECRET_KEY', () => {
    const { STRIPE_SECRET_KEY: _omit, ...rest } = base;
    expect(() => apiEnvSchema.parse(rest)).toThrow();
  });
  it('rejects missing STRIPE_WEBHOOK_SECRET', () => {
    const { STRIPE_WEBHOOK_SECRET: _omit, ...rest } = base;
    expect(() => apiEnvSchema.parse(rest)).toThrow();
  });
  it('coerces SERVICE_FEE_AMOUNT from a string', () => {
    expect(apiEnvSchema.parse({ ...base, SERVICE_FEE_AMOUNT: '7500' }).SERVICE_FEE_AMOUNT).toBe(7500);
  });
  it('defaults the bypass + payment-provider keys', () => {
    const out = apiEnvSchema.parse(base);
    expect(out.PAYMENT_PROVIDER).toBe('stripe');
    expect(out.CLERK_BYPASS_AUTH).toBe(false);
    expect(out.AUTH_BYPASS_TOKEN).toBe('');
    expect(out.AUTH_BYPASS_SUBJECT).toBe('test_clerk_user');
  });
  it('parses CLERK_BYPASS_AUTH as literal true only (no coerce-boolean footgun)', () => {
    const parse = (v: unknown) =>
      apiEnvSchema.parse({ ...base, CLERK_BYPASS_AUTH: v }).CLERK_BYPASS_AUTH;
    // Only literal boolean true or the string 'true' enables bypass.
    expect(parse('true')).toBe(true);
    expect(parse(true)).toBe(true);
    // Everything else — incl. the natural "turn it off" spellings — must be false.
    expect(parse('false')).toBe(false);
    expect(parse('0')).toBe(false);
    expect(parse('')).toBe(false);
    expect(parse(false)).toBe(false);
    expect(parse('TRUE')).toBe(false);
    expect(parse(undefined)).toBe(false);
    // Omitted entirely -> default false.
    expect(apiEnvSchema.parse(base).CLERK_BYPASS_AUTH).toBe(false);
  });
  it('rejects an invalid PAYMENT_PROVIDER', () => {
    expect(() => apiEnvSchema.parse({ ...base, PAYMENT_PROVIDER: 'paypal' })).toThrow();
  });
  it('refuses to parse in production when CLERK_BYPASS_AUTH is true', () => {
    expect(() => apiEnvSchema.parse({ ...base, NODE_ENV: 'production', CLERK_BYPASS_AUTH: true })).toThrow(
      'bypass env must not be set in production',
    );
  });
  it('refuses to parse in production when AUTH_BYPASS_TOKEN is non-empty', () => {
    expect(() =>
      apiEnvSchema.parse({ ...base, NODE_ENV: 'production', AUTH_BYPASS_TOKEN: 'tok' }),
    ).toThrow('bypass env must not be set in production');
  });
  it('allows bypass in non-production', () => {
    expect(() => apiEnvSchema.parse({ ...base, NODE_ENV: 'test', CLERK_BYPASS_AUTH: true, AUTH_BYPASS_TOKEN: 'tok' })).not.toThrow();
  });
});

describe('webEnvSchema', () => {
  it('requires publishable key', () => {
    expect(() => webEnvSchema.parse({})).toThrow();
    expect(webEnvSchema.parse({ VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_x' }).VITE_CLERK_PUBLISHABLE_KEY).toBe('pk_test_x');
  });
});

it('defaults fee + ttl + web api url', () => {
  const env = apiEnvSchema.parse({
    DATABASE_URL: 'postgres://u:p@h:5432/db',
    CLERK_SECRET_KEY: 'sk',
    STRIPE_SECRET_KEY: 'sk',
    STRIPE_WEBHOOK_SECRET: 'wh',
  } as Record<string, unknown>);
  expect(env.SERVICE_FEE_AMOUNT).toBe(400);
  expect(env.SERVICE_FEE_CURRENCY).toBe('usd');
  expect(env.HOLD_TTL_MINUTES).toBe(3);
  const web = webEnvSchema.parse({ VITE_CLERK_PUBLISHABLE_KEY: 'pk' } as Record<string, unknown>);
  expect(web.VITE_API_URL).toBe('/api');
});