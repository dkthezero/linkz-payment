import { describe, it, expect } from 'vitest';
import { shouldRegisterTestPayments } from './test-payments.controller';

describe('shouldRegisterTestPayments (test-succeed route production gate)', () => {
  it('registers when provider=test and non-production', () => {
    expect(shouldRegisterTestPayments({ PAYMENT_PROVIDER: 'test', NODE_ENV: 'development' })).toBe(true);
    expect(shouldRegisterTestPayments({ PAYMENT_PROVIDER: 'test', NODE_ENV: 'test' })).toBe(true);
  });

  it('does NOT register in production regardless of provider', () => {
    expect(shouldRegisterTestPayments({ PAYMENT_PROVIDER: 'test', NODE_ENV: 'production' })).toBe(false);
    expect(shouldRegisterTestPayments({ PAYMENT_PROVIDER: 'stripe', NODE_ENV: 'production' })).toBe(false);
  });

  it('does NOT register when provider is stripe (non-production)', () => {
    expect(shouldRegisterTestPayments({ PAYMENT_PROVIDER: 'stripe', NODE_ENV: 'development' })).toBe(false);
  });
});