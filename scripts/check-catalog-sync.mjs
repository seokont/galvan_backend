import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';
import { randomUUID, createHash } from 'node:crypto';
import { Pool } from 'pg';
import { syncCatalog } from './lib/catalog-sync.mjs';
import { migrate } from './lib/migrations.mjs';
if (existsSync('.env')) loadEnvFile('.env');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const storage = await mkdtemp(join(tmpdir(), 'atelier-sync-'));
const id = 2100000001,
  second = 2100000002,
  brand = 'QA Sync ' + randomUUID();
let source = [
  {
    id,
    name: 'AUTOMATED SYNC TEST',
    x_brand: brand,
    default_code: false,
    categ_id: [2100000001, brand + ' / QA collection'],
    public_categ_ids: [],
    product_variant_ids: [1],
    write_date: '2026-01-01 00:00:00',
    public_description: 'Satin',
    website_description: false,
  },
];
const image =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=';
let downloads = 0;
const reader = {
  all: async (model) => {
    if (model === 'product.template') return structuredClone(source);
    if (
      model === 'product.public.category' ||
      model === 'product.image' ||
      model === 'product.template.attribute.line' ||
      model === 'product.attribute.value'
    )
      return [];
    throw new Error('Unexpected model');
  },
  call: async (model, method, params) => {
    assert.ok(['product.template', 'product.image'].includes(model));
    assert.equal(method, 'search_read');
    downloads += params.domain[0][2].length;
    return params.domain[0][2].map((id) => ({ id, image_1024: image }));
  },
};
try {
  const connection = await pool.connect();
  try {
    await migrate(connection);
  } finally {
    connection.release();
  }
  assert.equal(
    (
      await pool.query(
        'SELECT 1 FROM atelier_catalog.products WHERE id=ANY($1::int[])',
        [[id, second]],
      )
    ).rowCount,
    0,
    'QA IDs already exist: abort safely',
  );
  const baseline = (
    await pool.query('SELECT count(*)::int AS n FROM atelier_catalog.products')
  ).rows[0].n;
  const imageFile = join(
    storage,
    'images',
    createHash('sha256').update(Buffer.from(image, 'base64')).digest('hex') +
      '.png',
  );
  await mkdir(join(storage, 'images'), { recursive: true });
  await writeFile(imageFile, 'partial write');
  const first = await syncCatalog({ pool, reader, storage });
  assert.deepEqual(
    await readFile(imageFile),
    Buffer.from(image, 'base64'),
    'repair interrupted final photo write',
  );
  assert.equal(first.added, 1);
  assert.equal(first.updated, 0);
  const before = (
    await pool.query(
      'SELECT imported_at,source_write_date FROM atelier_catalog.products WHERE id=$1',
      [id],
    )
  ).rows[0];
  const same = await syncCatalog({ pool, reader, storage });
  assert.equal(same.unchanged, 1);
  assert.equal(same.added, 0);
  assert.equal(same.updated, 0);
  assert.equal(downloads, 1);
  source[0].write_date = '2026-01-02 00:00:00';
  const timestampOnly = await syncCatalog({ pool, reader, storage });
  assert.equal(timestampOnly.unchanged, 1);
  assert.deepEqual(
    (
      await pool.query(
        'SELECT imported_at,source_write_date FROM atelier_catalog.products WHERE id=$1',
        [id],
      )
    ).rows[0],
    before,
  );
  await pool.query(
    'INSERT INTO atelier_catalog.product_overrides(product_id,changes) VALUES($1,$2::jsonb)',
    [id, JSON.stringify({ name: 'Manual Atelier title', visible: false })],
  );
  source[0].name = 'CHANGED SOURCE MODEL';
  source.push({ ...source[0], id: second, name: 'SECOND NEW MODEL' });
  const changed = await syncCatalog({ pool, reader, storage });
  assert.equal(changed.updated, 1);
  assert.equal(changed.added, 1);
  assert.equal(
    (
      await pool.query(
        'SELECT name FROM atelier_catalog.products WHERE id=$1',
        [id],
      )
    ).rows[0].name,
    'CHANGED SOURCE MODEL',
  );
  assert.deepEqual(
    (
      await pool.query(
        'SELECT name,visible FROM atelier_catalog.effective_products WHERE id=$1',
        [id],
      )
    ).rows[0],
    { name: 'Manual Atelier title', visible: false },
  );
  source[0].name = 'MUST ROLL BACK';
  await assert.rejects(
    syncCatalog({
      pool,
      reader,
      storage,
      onComplete: async () => {
        throw new Error('Simulated job persistence failure');
      },
    }),
    /Simulated/,
  );
  assert.equal(
    (
      await pool.query(
        'SELECT name FROM atelier_catalog.products WHERE id=$1',
        [id],
      )
    ).rows[0].name,
    'CHANGED SOURCE MODEL',
  );
  assert.equal(
    (
      await pool.query(
        'SELECT count(*)::int AS n FROM atelier_catalog.products',
      )
    ).rows[0].n,
    baseline + 2,
    'unrelated products preserved',
  );
  const lock = await pool.connect();
  try {
    await lock.query('SELECT pg_advisory_lock(74182016)');
    await assert.rejects(
      syncCatalog({ pool, reader, storage }),
      /Another catalog/,
    );
  } finally {
    await lock.query('SELECT pg_advisory_unlock(74182016)');
    lock.release();
  }
  console.log(
    'Incremental catalogue sync OK: new/changed/identical, timestamp-only no-op, cached photos, preserved manual edits, atomic rollback and single importer lock.',
  );
} finally {
  // Delete only records carrying our unique QA brand, never an unrelated reused ID.
  const own = (
    await pool.query(
      'SELECT p.id,p.brand_slug FROM atelier_catalog.products p JOIN atelier_catalog.brands b ON b.slug=p.brand_slug WHERE b.name=$1',
      [brand],
    )
  ).rows;
  const ids = own.map((p) => p.id);
  await pool.query(
    'DELETE FROM atelier_catalog.product_collections WHERE product_id=ANY($1::int[])',
    [ids],
  );
  await pool.query(
    'DELETE FROM atelier_catalog.product_overrides WHERE product_id=ANY($1::int[])',
    [ids],
  );
  await pool.query(
    'DELETE FROM atelier_catalog.products WHERE id=ANY($1::int[])',
    [ids],
  );
  await pool.query(
    'DELETE FROM atelier_catalog.collections WHERE brand_slug IN (SELECT slug FROM atelier_catalog.brands WHERE name=$1)',
    [brand],
  );
  await pool.query('DELETE FROM atelier_catalog.brands WHERE name=$1', [brand]);
  await pool.end();
  await rm(storage, { recursive: true, force: true });
}
