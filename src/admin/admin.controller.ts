import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { CookieOptions, Request, Response } from 'express';
import { ADMIN_COOKIE, AdminAuthService, SESSION_MS } from './admin-auth.service';
import { AdminGuard } from './admin.guard';

class LoginDto {
  @IsString()
  @MaxLength(200)
  password!: string;
}

const cookieOptions = (req: Request): CookieOptions => ({
  httpOnly: true,
  sameSite: 'strict',
  secure: req.secure,
  path: '/api',
});

@Controller('admin')
export class AdminController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post('login')
  @HttpCode(204)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (!this.auth.configured) {
      throw new ServiceUnavailableException('ADMIN_PASSWORD is not set in .env');
    }
    if (!this.auth.checkPassword(dto.password)) {
      await new Promise((resolve) => setTimeout(resolve, 1000)); // slows down guessing
      throw new UnauthorizedException('Wrong password');
    }
    res.cookie(ADMIN_COOKIE, this.auth.issueToken(), { ...cookieOptions(req), maxAge: SESSION_MS });
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.clearCookie(ADMIN_COOKIE, cookieOptions(req));
  }

  @Get('session')
  @UseGuards(AdminGuard)
  session() {
    return { ok: true };
  }
}
