import { loadEnvFile } from 'node:process';
import { Pool } from 'pg';
import { migrate } from './lib/migrations.mjs';
loadEnvFile('.env');
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
