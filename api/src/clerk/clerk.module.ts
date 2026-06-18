import { Module } from '@nestjs/common';
import { ClerkGuard } from './clerk.guard';
import { clerkConfigProvider, CLERK_CONFIG } from './clerk.config';
import { ClerkBackendService } from './clerk.backend';

@Module({
  providers: [clerkConfigProvider, ClerkGuard, ClerkBackendService],
  exports: [ClerkGuard, CLERK_CONFIG, ClerkBackendService],
})
export class ClerkModule {}