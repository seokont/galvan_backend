import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { Pool } from 'pg';
import { OdooReader } from './lib/odoo-readonly.mjs';
import { syncCatalog } from './lib/catalog-sync.mjs';
if (existsSync('.env')) loadEnvFile('.env');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
  query_timeout: 15000,
});
try {
  if (!process.env.DATABASE_URL)
    throw new Error('Missing database configuration');
  const reader = new OdooReader({
    url: process.env.ODOO_URL,
    database: process.env.ODOO_DATABASE,
    key: process.env.ODOO_API_KEY,
  });
  const result = await syncCatalog({
    pool,
    reader,
    storage: process.env.CATALOG_STORAGE_DIR || 'storage/catalog',
    onProgress: async (progress) => {
      console.log(JSON.stringify(progress));
    },
  });
  console.log(JSON.stringify(result));
} catch {
  console.error(
    'Catalog synchronization failed. Check Odoo access, storage and database configuration.',
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
