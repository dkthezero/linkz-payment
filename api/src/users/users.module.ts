import { Module } from '@nestjs/common';
import { ClerkModule } from '../clerk/clerk.module';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { DrizzleUserRepository } from './adapters/drizzle.user.repository';
import { USER_REPOSITORY } from './user.repository';
import { UserResolver } from './user.resolver';

@Module({
  imports: [DrizzleModule, ClerkModule],
  providers: [
    { provide: USER_REPOSITORY, useClass: DrizzleUserRepository },
    UserResolver,
  ],
  exports: [UserResolver, USER_REPOSITORY],
})
export class UsersModule {}