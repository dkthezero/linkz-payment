import { Inject, Injectable } from '@nestjs/common';
import { createClerkClient } from '@clerk/backend';
import { ClerkConfig, CLERK_CONFIG } from './clerk.config';

export class ClerkUserNotFoundError extends Error {
  constructor(public readonly sub: string) {
    super(`Clerk user not found: ${sub}`);
    this.name = 'ClerkUserNotFoundError';
  }
}

export interface ClerkUserProfile {
  email: string;
  name: string;
}

@Injectable()
export class ClerkBackendService {
  private readonly client: ReturnType<typeof createClerkClient>;

  constructor(@Inject(CLERK_CONFIG) config: ClerkConfig) {
    this.client = createClerkClient({ secretKey: config.secretKey });
  }

  async getUserProfile(sub: string): Promise<ClerkUserProfile> {
    let user;
    try {
      user = await this.client.users.getUser(sub);
    } catch (e) {
      if ((e as { status?: number })?.status === 404) throw new ClerkUserNotFoundError(sub);
      throw e;
    }
    const email =
      user.emailAddresses?.find((e: { id: string }) => e.id === user.primaryEmailAddressId)?.emailAddress ??
      user.emailAddresses?.[0]?.emailAddress;
    if (!email) throw new Error(`Clerk user ${sub} has no email address`);
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || email;
    return { email, name };
  }
}