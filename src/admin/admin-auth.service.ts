import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, scryptSync, timingSafeEqual } from 'crypto';

export const ADMIN_COOKIE = 'sc_admin';
export const SESSION_MS = 12 * 60 * 60 * 1000;

/**
 * One shared admin password (ADMIN_PASSWORD). A login gives a signed, expiring
 * token. Changing the password signs everyone out.
 */
@Injectable()
export class AdminAuthService {
  private readonly password: string;
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.password = config.get<string>('ADMIN_PASSWORD') || '';
    this.key = scryptSync(this.password, 'script-checker-admin-session', 32);
  }

  /** Without a password the admin area stays locked. */
  get configured(): boolean {
    return this.password.length > 0;
  }

  checkPassword(candidate: string): boolean {
    return this.configured && safeEqual(candidate, this.password);
  }

  issueToken(): string {
    const expires = String(Date.now() + SESSION_MS);
    return `${expires}.${this.sign(expires)}`;
  }

  verifyToken(token: string | undefined): boolean {
    if (!this.configured || !token) return false;
    const [expires, signature] = token.split('.');
    if (!expires || !signature || !safeEqual(signature, this.sign(expires))) return false;
    return Number(expires) > Date.now();
  }

  private sign(value: string): string {
    return createHmac('sha256', this.key).update(value).digest('hex');
  }
}

/** Hashing first gives equal lengths, which timingSafeEqual requires. */
function safeEqual(a: string, b: string): boolean {
  const hash = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(hash(a), hash(b));
}
