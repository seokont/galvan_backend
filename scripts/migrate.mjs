import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { Pool } from 'pg';
import { migrate } from './lib/migrations.mjs';
if (existsSync('.env')) loadEnvFile('.env');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
const db = await pool.connect();
try {
  await migrate(db);
  console.log('Atelier migrations applied');
} finally {
  db.release();
  await pool.end();
}
