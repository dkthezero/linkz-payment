import { Controller, Get } from '@nestjs/common';
import { HealthResponseSchema } from '@linkz/shared';

@Controller('health')
export class HealthController {
  @Get()
  health() {
    return HealthResponseSchema.parse({ status: 'ok' });
  }
}