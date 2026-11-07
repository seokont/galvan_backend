import { loadEnvFile } from 'node:process';
import { appendFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { hashPassword } from '../dist/admin/password.js';
loadEnvFile('.env');
const email = (process.env.ADMIN_EMAIL || 'admin@atelier.local')
  .trim()
  .toLowerCase();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
try {
  const existing = await pool.query(
    'SELECT id FROM atelier_catalog.admin_accounts WHERE email=$1',
    [email],
  );
  if (existing.rows.length && !process.argv.includes('--reset'))
    console.log('Administrator already exists; password unchanged.');
  else {
    const password =
      process.env.ADMIN_INITIAL_PASSWORD ||
      randomBytes(24).toString('base64url');
    if (password.length < 12 || password.length > 256)
      throw new Error('ADMIN_INITIAL_PASSWORD must contain 12–256 characters');
    if (!process.env.ADMIN_EMAIL)
      await appendFile('.env', '\nADMIN_EMAIL=' + email + '\n');
    if (!process.env.ADMIN_INITIAL_PASSWORD)
      await appendFile('.env', 'ADMIN_INITIAL_PASSWORD=' + password + '\n');
    const hash = await hashPassword(password);
    const result = await pool.query(
      'INSERT INTO atelier_catalog.admin_accounts(email,password_hash) VALUES($1,$2) ON CONFLICT(email) DO UPDATE SET password_hash=EXCLUDED.password_hash RETURNING id',
      [email, hash],
    );
    await pool.query(
      'DELETE FROM atelier_catalog.admin_sessions WHERE admin_id=$1',
      [result.rows[0].id],
    );
    console.log(
      'Administrator configured. Login details are in backend/.env: ADMIN_EMAIL and ADMIN_INITIAL_PASSWORD.',
    );
  }
} finally {
  await pool.end();
}
