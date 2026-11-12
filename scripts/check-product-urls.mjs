import 'reflect-metadata';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { migrate } from './lib/migrations.mjs';
const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) loadEnvFile(envFile);
const { CatalogService } = await import('../dist/catalog/catalog.service.js');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = await pool.connect();
const suffix = randomUUID().slice(0, 8),
  brand = 'url-qa-' + suffix,
  ids = [2100000011, 2100000012, 2100000013];
try {
  await migrate(db);
  await db.query('BEGIN');
  assert.equal(
    (
      await db.query(
        'SELECT 1 FROM atelier_catalog.products WHERE id=ANY($1::int[])',
        [ids],
      )
    ).rowCount,
    0,
  );
  await db.query(
    'INSERT INTO atelier_catalog.brands(slug,name) VALUES($1,$2)',
    [brand, 'URL QA ' + suffix],
  );
  const base = 'Étoile Bridal ' + suffix;
  for (const id of ids)
    await db.query(
      'INSERT INTO atelier_catalog.products(id,slug,name,brand_slug) VALUES($1,$2,$3,$4)',
      [id, 'odoo-' + id, base, brand],
    );
  const rows = (
    await db.query(
      'SELECT id,slug,imported_at FROM atelier_catalog.products WHERE id=ANY($1::int[]) ORDER BY id',
      [ids],
    )
  ).rows;
  assert.equal(rows[0].slug, 'etoile-bridal-' + suffix);
  const catalog = new CatalogService(db);
  assert.equal((await catalog.detail('odoo-' + ids[0])).slug, rows[0].slug);
  assert.equal((await catalog.detail(rows[1].slug)).id, ids[1]);
  assert.equal(new Set(rows.map((r) => r.slug)).size, 3);
  assert.ok(
    rows.every(
      (r) => /^[a-z0-9-]{1,100}$/.test(r.slug) && !r.slug.startsWith('odoo-'),
    ),
  );
  assert.equal(
    (
      await db.query(
        'SELECT product_id FROM atelier_catalog.product_slug_aliases WHERE slug=$1',
        ['odoo-' + ids[0]],
      )
    ).rows[0].product_id,
    ids[0],
  );
  await db.query(
    'INSERT INTO atelier_catalog.product_overrides(product_id,changes) VALUES($1,$2::jsonb)',
    [ids[0], JSON.stringify({ name: 'Нова Сукня ' + suffix })],
  );
  const renamed = (
    await db.query(
      'SELECT slug,imported_at FROM atelier_catalog.products WHERE id=$1',
      [ids[0]],
    )
  ).rows[0];
  assert.equal(renamed.slug, 'nova-suknia-' + suffix);
  await db.query(
    'UPDATE atelier_catalog.product_overrides SET changes=changes||$2::jsonb WHERE product_id=$1',
    [ids[0], '{"visible":false}'],
  );
  await assert.rejects(catalog.detail('odoo-' + ids[0]), /Product not found/);
  await assert.rejects(catalog.detail(renamed.slug), /Product not found/);
  await db.query(
    "UPDATE atelier_catalog.product_overrides SET changes=changes-'visible' WHERE product_id=$1",
    [ids[0]],
  );
  await db.query('UPDATE atelier_catalog.products SET slug=$2 WHERE id=$1', [
    ids[0],
    'odoo-' + ids[0],
  ]);
  assert.equal(
    (
      await db.query('SELECT slug FROM atelier_catalog.products WHERE id=$1', [
        ids[0],
      ])
    ).rows[0].slug,
    renamed.slug,
    'an older importer cannot restore odoo-ID URLs',
  );
  assert.deepEqual(renamed.imported_at, rows[0].imported_at);
  assert.equal(
    (
      await db.query(
        'SELECT product_id FROM atelier_catalog.product_slug_aliases WHERE slug=$1',
        [rows[0].slug],
      )
    ).rows[0].product_id,
    ids[0],
  );
  await db.query(
    "UPDATE atelier_catalog.products SET name='Changed Odoo source name' WHERE id=$1",
    [ids[0]],
  );
  assert.equal(
    (
      await db.query('SELECT slug FROM atelier_catalog.products WHERE id=$1', [
        ids[0],
      ])
    ).rows[0].slug,
    renamed.slug,
  );
  await db.query(
    'UPDATE atelier_catalog.product_overrides SET changes=$2::jsonb WHERE product_id=$1',
    [ids[0], '{}'],
  );
  assert.equal(
    (
      await db.query('SELECT slug FROM atelier_catalog.products WHERE id=$1', [
        ids[0],
      ])
    ).rows[0].slug,
    'changed-odoo-source-name',
  );
  await db.query('UPDATE atelier_catalog.products SET name=$2 WHERE id=$1', [
    ids[1],
    'я'.repeat(120),
  ]);
  assert.ok(
    (
      await db.query('SELECT slug FROM atelier_catalog.products WHERE id=$1', [
        ids[1],
      ])
    ).rows[0].slug.length <= 100,
  );
  console.log(
    'Product URLs OK: name slug, duplicates, accents/Cyrillic/length, aliases, manual-name precedence, reset and unchanged import timestamp.',
  );
} finally {
  await db.query('ROLLBACK');
  db.release();
  await pool.end();
}
