import { Controller, Get, InternalServerErrorException, Req, UseGuards } from '@nestjs/common';
import { MeResponseSchema } from '@linkz/shared';
import { ClerkGuard, AuthenticatedRequest } from '../clerk/clerk.guard';
import { UserResolver } from '../users/user.resolver';

@Controller('me')
@UseGuards(ClerkGuard, UserResolver)
export class MeController {
  @Get()
  me(@Req() req: AuthenticatedRequest) {
    if (!req.appUser || !req.user) throw new InternalServerErrorException('Not authenticated');
    return MeResponseSchema.parse({
      appUserId: req.appUser.id,
      clerkUserId: req.user,
      email: req.appUser.email,
      name: req.appUser.name,
    });
  }
}