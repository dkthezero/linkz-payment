import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@clerk/backend', () => ({ createClerkClient: vi.fn() }));
import { createClerkClient } from '@clerk/backend';
import { ClerkBackendService, ClerkUserNotFoundError } from './clerk.backend';

const mockUser = (overrides: Record<string, unknown> = {}) => ({
  firstName: 'Alice',
  lastName: 'Smith',
  username: 'alice',
  primaryEmailAddressId: 'e1',
  emailAddresses: [{ id: 'e1', emailAddress: 'alice@example.com' }],
  ...overrides,
});

const makeService = (getUser: ReturnType<typeof vi.fn>) => {
  vi.mocked(createClerkClient).mockReturnValue({ users: { getUser } } as any);
  return new ClerkBackendService({ secretKey: 'sk_x', authorizedParties: [] } as any);
};

describe('ClerkBackendService.getUserProfile', () => {
  beforeEach(() => vi.mocked(createClerkClient).mockClear());

  it('returns email + name from firstName/lastName', async () => {
    const getUser = vi.fn().mockResolvedValue(mockUser());
    const out = await makeService(getUser).getUserProfile('user_1');
    expect(out).toEqual({ email: 'alice@example.com', name: 'Alice Smith' });
    expect(getUser).toHaveBeenCalledWith('user_1');
  });
  it('falls back to username when no firstName/lastName', async () => {
    const getUser = vi.fn().mockResolvedValue(mockUser({ firstName: '', lastName: '' }));
    expect((await makeService(getUser).getUserProfile('user_1')).name).toBe('alice');
  });
  it('falls back to email when no name at all', async () => {
    const getUser = vi.fn().mockResolvedValue(mockUser({ firstName: '', lastName: '', username: '' }));
    expect((await makeService(getUser).getUserProfile('user_1')).name).toBe('alice@example.com');
  });
  it('throws ClerkUserNotFoundError on 404', async () => {
    const getUser = vi.fn().mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }));
    await expect(makeService(getUser).getUserProfile('user_1')).rejects.toBeInstanceOf(ClerkUserNotFoundError);
  });
  it('rethrows non-404 errors', async () => {
    const getUser = vi.fn().mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    await expect(makeService(getUser).getUserProfile('user_1')).rejects.toThrow('boom');
  });
});