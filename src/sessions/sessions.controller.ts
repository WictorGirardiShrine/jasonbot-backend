import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthUser } from '../auth/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { renameSessionSchema, type RenameSessionInput } from './sessions.schemas';
import { SessionsService } from './sessions.service';

@Controller('sessions')
@UseGuards(JwtAuthGuard)
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.sessions.listForUser(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser) {
    return this.sessions.create(user.id);
  }

  @Patch(':id')
  rename(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(renameSessionSchema)) body: RenameSessionInput,
  ) {
    return this.sessions.rename(id, user.id, body.title);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.sessions.delete(id, user.id);
  }
}
