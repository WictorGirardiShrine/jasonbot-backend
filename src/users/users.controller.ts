import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthUser } from '../auth/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { updateProfileSchema, type UpdateProfileInput } from './users.schemas';
import { UsersService } from './users.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return this.users.getOrCreateProfile(user.id, user.email);
  }

  @Patch('me')
  async updateMe(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileInput,
  ) {
    return this.users.updateName(user.id, user.email, body.name);
  }

  @Post('auth/disclaimer')
  @HttpCode(HttpStatus.NO_CONTENT)
  async acceptDisclaimer(@CurrentUser() user: AuthUser): Promise<void> {
    await this.users.acceptDisclaimer(user.id);
  }
}
