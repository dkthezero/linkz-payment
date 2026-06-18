import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { verifyToken } from '@clerk/backend';
import type { Request } from 'express';
import type { AppUser } from '@linkz/shared';
import { ClerkConfig, CLERK_CONFIG } from './clerk.config';

export interface AuthenticatedRequest extends Request {
  user?: string; // Clerk subject (sub)
  clerkSessionId?: string;
  clerkClaims?: { sub: string; sid?: string };
  appUser?: AppUser; // set by UserResolver
}

/**
 * Pure decision for the test-auth bypass branch. Extracted so the security
 * logic is unit-testable without Clerk SDK deps.
 *
 * - 'bypass': present a valid Bearer token matching the configured bypass
 *   token, in a non-production environment with bypassAuth enabled.
 * - 'reject': bypassAuth is enabled (non-prod) but the presented credentials
 *   are missing/empty/mismatched, or no bypass token is configured. Caller
 *   MUST throw UnauthorizedException.
 * - 'real': do not attempt bypass; fall through to real Clerk verification.
 *   Production NEVER bypasses, even if bypassAuth is set (defense-in-depth).
 */
export type BypassDecision = 'bypass' | 'reject' | 'real';

export interface BypassInput {
  nodeEnv: string;
  bypassAuth: boolean;
  bypassToken: string;
  authHeader: string | undefined;
}

export function decideBypass(input: BypassInput): BypassDecision {
  if (input.nodeEnv === 'production') return 'real';
  if (!input.bypassAuth) return 'real';
  // bypassAuth is true and non-prod — a bypass token MUST be configured.
  if (input.bypassToken === '') return 'reject';
  const header = input.authHeader;
  if (!header || !header.startsWith('Bearer ')) return 'reject';
  const presented = header.slice('Bearer '.length).trim();
  if (!presented || presented !== input.bypassToken) return 'reject';
  return 'bypass';
}

@Injectable()
export class ClerkGuard implements CanActivate {
  constructor(@Inject(CLERK_CONFIG) private readonly config: ClerkConfig) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const decision = decideBypass({
      nodeEnv: this.config.nodeEnv,
      bypassAuth: this.config.bypassAuth,
      bypassToken: this.config.bypassToken,
      authHeader: req.headers.authorization,
    });

    if (decision === 'bypass') {
      req.user = this.config.bypassSubject;
      req.clerkClaims = { sub: this.config.bypassSubject };
      return true;
    }
    if (decision === 'reject') {
      throw new UnauthorizedException('Invalid or missing bypass token');
    }

    // decision === 'real' — verify the real Clerk JWT.
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Missing Bearer token');
    const token = header.slice('Bearer '.length).trim();
    if (!token) throw new UnauthorizedException('Empty Bearer token');
    try {
      const verified = await verifyToken(token, {
        secretKey: this.config.secretKey,
        jwtKey: this.config.jwtKey,
        authorizedParties: this.config.authorizedParties,
      });
      req.user = verified.sub;
      req.clerkSessionId = verified.sid;
      req.clerkClaims = { sub: verified.sub, sid: verified.sid };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired Clerk session token');
    }
  }
}