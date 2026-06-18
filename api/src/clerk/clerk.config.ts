import { ConfigService } from '@nestjs/config';
import type { Provider } from '@nestjs/common';

export interface ClerkConfig {
  secretKey: string;
  jwtKey?: string;
  authorizedParties: string[];
  bypassAuth: boolean;
  bypassToken: string;
  bypassSubject: string;
  nodeEnv: string;
}

export const CLERK_CONFIG = 'CLERK_CONFIG';

export const clerkConfigProvider: Provider = {
  provide: CLERK_CONFIG,
  useFactory: (config: ConfigService): ClerkConfig => {
    const nodeEnv = config.get<string>('NODE_ENV') ?? 'development';
    const bypassAuth = config.get<boolean>('CLERK_BYPASS_AUTH') ?? false;
    const bypassToken = config.get<string>('AUTH_BYPASS_TOKEN') ?? '';
    const bypassSubject = config.get<string>('AUTH_BYPASS_SUBJECT') ?? 'test_clerk_user';
    const secretKey = config.get<string>('CLERK_SECRET_KEY');
    if (!secretKey && !bypassAuth) throw new Error('CLERK_SECRET_KEY is not configured');
    const jwtKey = config.get<string>('CLERK_JWT_KEY') || undefined;
    const authorizedParties = (config.get<string>('CLERK_AUTHORIZED_PARTIES') ?? 'http://localhost:18601')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      secretKey: secretKey ?? '',
      jwtKey,
      authorizedParties,
      bypassAuth,
      bypassToken,
      bypassSubject,
      nodeEnv,
    };
  },
  inject: [ConfigService],
};