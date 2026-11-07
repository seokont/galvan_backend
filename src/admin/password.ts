import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      password,
      salt,
      64,
      { N: 32768, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}
export const sessionHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt);
  return `scrypt$32768$${salt}$${hash.toString('hex')}`;
}
export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const match = /^scrypt\$32768\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(
    encoded,
  );
  if (!match) return false;
  const hash = await derive(password, match[1]);
  return timingSafeEqual(hash, Buffer.from(match[2], 'hex'));
}
