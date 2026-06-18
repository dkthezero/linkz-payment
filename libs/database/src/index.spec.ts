import { describe, it, expect } from 'vitest';
import { createDb, getDb, users, webhookEvents } from './index';

describe('@linkz/database package root', () => {
  it('exports the db factory + singleton', () => {
    expect(typeof createDb).toBe('function');
    expect(typeof getDb).toBe('function');
  });
  it('exports the users + webhook_events tables', () => {
    expect(users).toBeDefined();
    expect(webhookEvents).toBeDefined();
  });
});