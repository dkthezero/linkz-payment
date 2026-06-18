import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthenticatedRequest } from '../clerk/clerk.guard';
import { CLERK_CONFIG, type ClerkConfig } from '../clerk/clerk.config';
import { ClerkBackendService, ClerkUserNotFoundError } from '../clerk/clerk.backend';
import { USER_REPOSITORY, UserRepository } from './user.repository';

@Injectable()
export class UserResolver implements CanActivate {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    private readonly clerkBackend: ClerkBackendService,
    @Inject(CLERK_CONFIG) private readonly config: ClerkConfig,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const sub = req.user;
    if (!sub) throw new InternalServerErrorException('UserResolver ran without a verified Clerk subject');

    let appUser = await this.users.findByExternalId(sub);
    if (!appUser) {
      if (this.config.bypassAuth) {
        appUser = await this.users.upsert(sub, 'test@example.com', 'Test User');
      } else {
        let profile;
        try {
          profile = await this.clerkBackend.getUserProfile(sub);
        } catch (e) {
          if (e instanceof ClerkUserNotFoundError) throw new UnauthorizedException('Clerk user no longer exists');
          throw new ServiceUnavailableException('Unable to provision user');
        }
        appUser = await this.users.upsert(sub, profile.email, profile.name);
      }
    }
    req.appUser = appUser;
    return true;
  }
}