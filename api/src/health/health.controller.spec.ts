import { describe, it, expect } from 'vitest';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns { status: ok }', () => {
    expect(new HealthController().health()).toEqual({ status: 'ok' });
  });
});