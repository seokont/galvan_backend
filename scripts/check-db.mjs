import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { Pool } from 'pg';

if (existsSync('.env')) loadEnvFile('.env');
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is missing. Add it to backend/.env.');
  process.exit(1);
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
  query_timeout: 5000,
});
pool.on('error', () => {
  console.error('PostgreSQL connection lost');
  process.exitCode = 1;
});
try {
  const result = await pool.query('SELECT 1 AS ok');
  if (result.rows[0]?.ok !== 1) throw new Error('Unexpected response');
  console.log('PostgreSQL connection OK (SELECT 1)');
} catch (error) {
  const safeCodes = [
    '28P01',
    '3D000',
    'ECONNREFUSED',
    'ENOTFOUND',
    'ETIMEDOUT',
  ];
  const code = safeCodes.includes(error.code)
    ? error.code
    : 'CONNECTION_FAILED';
  console.error(
    `PostgreSQL connection failed: ${code}. Check DATABASE_URL and server availability.`,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
