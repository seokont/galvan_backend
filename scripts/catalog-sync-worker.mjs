import { Pool } from 'pg';
import { OdooReader } from './lib/odoo-readonly.mjs';
import { syncCatalog } from './lib/catalog-sync.mjs';
const id = process.argv[2];
if (!/^[a-f0-9-]{36}$/.test(id || '')) throw new Error('Invalid sync job');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
  query_timeout: 15000,
});
let timer,
  heartbeatBusy = false,
  stopped = false;
let stage = 'starting';
try {
  const initial = await pool.query(
    "UPDATE atelier_catalog.catalog_sync_runs SET heartbeat_at=now() WHERE id=$1 AND status='running'",
    [id],
  );
  if (!initial.rowCount) throw new Error('Sync job is no longer active');
  timer = setInterval(async () => {
    if (heartbeatBusy) return;
    heartbeatBusy = true;
    try {
      const r = await pool.query(
        "UPDATE atelier_catalog.catalog_sync_runs SET heartbeat_at=now() WHERE id=$1 AND status='running'",
        [id],
      );
      if (!r.rowCount) stopped = true;
    } catch {
      stopped = true;
    } finally {
      heartbeatBusy = false;
    }
  }, 15000);
  const reader = new OdooReader({
    url: process.env.ODOO_URL,
    database: process.env.ODOO_DATABASE,
    key: process.env.ODOO_API_KEY,
  });
  await syncCatalog({
    pool,
    reader,
    storage: process.env.CATALOG_STORAGE_DIR || 'storage/catalog',
    onProgress: async ({ phase, stats, currentModel }) => {
      stage = phase;
      if (stopped) throw new Error('Sync job interrupted');
      const r = await pool.query(
        "UPDATE atelier_catalog.catalog_sync_runs SET phase=$2,stats=$3::jsonb,current_model=$4,heartbeat_at=now() WHERE id=$1 AND status='running'",
        [id, phase, JSON.stringify(stats), currentModel],
      );
      if (!r.rowCount) throw new Error('Sync job is no longer active');
    },
    onComplete: async (result, db) => {
      const r = await db.query(
        "UPDATE atelier_catalog.catalog_sync_runs SET status='succeeded',phase='done',stats=$2::jsonb,result=$2::jsonb,current_model='',finished_at=now(),heartbeat_at=now() WHERE id=$1 AND status='running'",
        [id, JSON.stringify(result)],
      );
      if (!r.rowCount) throw new Error('Sync job is no longer active');
    },
  });
} catch (error) {
  const allowedCodes = new Set([
    'EACCES',
    'ENOENT',
    'ENOSPC',
    'ETIMEDOUT',
    '23505',
    '23503',
    '42P01',
    '57014',
    '08006',
  ]);
  console.error('Catalog sync failed', {
    job: id,
    stage,
    code: allowedCodes.has(error.code)
      ? error.code
      : error.message?.startsWith('Odoo')
        ? 'ODOO_READ_FAILED'
        : 'SYNC_FAILED',
  });
  const safe = error.message?.startsWith('Another catalog')
    ? 'Інший імпорт уже виконується. Спробуйте після його завершення.'
    : error.message?.startsWith('Odoo')
      ? 'Не вдалося прочитати дані Odoo. Перевірте доступ і повторіть синхронізацію.'
      : 'Синхронізацію не завершено. Наявний каталог збережено; перевірте журнал сервера та повторіть спробу.';
  await pool
    .query(
      "UPDATE atelier_catalog.catalog_sync_runs SET status='failed',phase='failed',error=$2,finished_at=now(),heartbeat_at=now() WHERE id=$1 AND status='running'",
      [id, safe],
    )
    .catch(() => {});
  process.exitCode = 1;
} finally {
  clearInterval(timer);
  await pool.end();
}
