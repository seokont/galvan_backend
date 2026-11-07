import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { sessionHash, verifyPassword, hashPassword } from './password.js';
@Injectable()
export class AdminAuthService {
  private dummyHash: Promise<string> | undefined;
  constructor(@Inject(Pool) private readonly db: Pool) {}
  async login(body: unknown) {
    const b = body as { email?: unknown; password?: unknown };
    if (
      !b ||
      typeof b.email !== 'string' ||
      typeof b.password !== 'string' ||
      b.email.length > 254 ||
      b.password.length > 256 ||
      !b.password
    )
      throw new BadRequestException('Введите email и пароль');
    const result = await this.db.query(
      'SELECT id,email,password_hash FROM atelier_catalog.admin_accounts WHERE email=$1',
      [b.email.trim().toLowerCase()],
    );
    const account = result.rows[0];
    this.dummyHash ??= hashPassword(randomBytes(24).toString('base64url'));
    const verified = await verifyPassword(
      b.password,
      account?.password_hash ?? (await this.dummyHash),
    );
    if (!account || !verified)
      throw new UnauthorizedException('Неверный email или пароль');
    const token = randomBytes(32).toString('base64url');
    await this.db.query(
      'DELETE FROM atelier_catalog.admin_sessions WHERE expires_at<now()',
    );
    await this.db.query(
      "INSERT INTO atelier_catalog.admin_sessions(token_hash,admin_id,expires_at) VALUES($1,$2,now()+interval '8 hours')",
      [sessionHash(token), account.id],
    );
    return { token, admin: { id: account.id, email: account.email } };
  }
  async authenticate(
    header: string | undefined,
  ): Promise<{ id: number; email: string }> {
    const token = header?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (!token)
      throw new UnauthorizedException('Требуется вход администратора');
    const result = await this.db.query(
      'SELECT a.id,a.email FROM atelier_catalog.admin_sessions s JOIN atelier_catalog.admin_accounts a ON a.id=s.admin_id WHERE s.token_hash=$1 AND s.expires_at>now()',
      [sessionHash(token)],
    );
    if (!result.rows[0])
      throw new UnauthorizedException('Сессия истекла. Войдите снова');
    return result.rows[0];
  }
  async logout(header: string | undefined) {
    const token = header?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (token)
      await this.db.query(
        'DELETE FROM atelier_catalog.admin_sessions WHERE token_hash=$1',
        [sessionHash(token)],
      );
    return { ok: true };
  }
}
