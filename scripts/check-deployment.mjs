import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';

const base = process.env.DEPLOYMENT_URL || 'http://127.0.0.1:3001';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const counts = {};
  for (const table of ['products', 'brands', 'collections', 'product_overrides', 'admin_accounts', 'admin_sessions']) {
    counts[table] = (await pool.query(`SELECT count(*)::int AS n FROM atelier_catalog.${table}`)).rows[0].n;
  }
  const page = await fetch(base + '/catalog/products').then(async r => { assert.equal(r.status, 200); return r.json(); });
  assert.ok(page.total > 0);
  const facets = await fetch(base + '/catalog/facets').then(async r => { assert.equal(r.status, 200); return r.json(); });
  assert.equal(page.total, facets.brands.reduce((n, b) => n + b.count, 0));
  const rows = await pool.query('SELECT images FROM atelier_catalog.effective_products WHERE visible');
  const files = new Set(rows.rows.flatMap(p => p.images));
  for (const file of files) await access(resolve(process.env.CATALOG_STORAGE_DIR || 'storage/catalog', 'images', file));
  const product = page.items.find(p => p.images.length);
  assert.ok(product);
  const image = await fetch(base + product.images[0].replace('/api/catalog/', '/catalog/'));
  assert.equal(image.status, 200);
  assert.ok(image.headers.get('content-type').startsWith('image/'));
  assert.ok((await image.arrayBuffer()).byteLength > 0);
  assert.equal((await fetch(base + '/admin/products')).status, 401);
  assert.equal((await fetch(base + '/admin/auth/session')).status, 401);
  console.log(JSON.stringify({ counts, visibleProducts: page.total, verifiedImageFiles: files.size, apiAndMedia: 'OK', unauthenticatedAdmin: 'rejected' }, null, 2));
} finally {
  await pool.end();
}
