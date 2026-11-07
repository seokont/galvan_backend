import 'reflect-metadata';
import { loadEnvFile } from 'node:process';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
loadEnvFile('.env');
const { AppModule } = await import('../dist/app.module.js');
const app = await NestFactory.create(AppModule, { logger: false });
try {
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  async function get(path) {
    const r = await fetch(base + path);
    assert.equal(r.status, 200, path);
    return r.json();
  }
  const facets = await get('/catalog/facets');
  assert.ok(facets.brands.length > 0);
  const page = await get('/catalog/products');
  assert.equal(page.items.length, Math.min(24, page.total));
  assert.equal(
    page.total,
    facets.brands.reduce((n, b) => n + b.count, 0),
  );
  const second = await get('/catalog/products?page=2');
  assert.ok(
    !second.items.some((p) => page.items.some((first) => first.id === p.id)),
  );
  const collection = facets.collections[0];
  const filtered = await get(
    '/catalog/products?' +
      new URLSearchParams({
        brand: collection.brandSlug,
        collection: collection.key,
      }),
  );
  assert.equal(filtered.total, collection.count);
  assert.ok(
    filtered.items.every(
      (p) =>
        p.brand.slug === collection.brandSlug &&
        p.collections.some((c) => c.key === collection.key),
    ),
  );
  const mismatchBrand = facets.brands.find(
    (b) => b.slug !== collection.brandSlug,
  );
  assert.equal(
    (
      await get(
        '/catalog/products?' +
          new URLSearchParams({
            brand: mismatchBrand.slug,
            collection: collection.key,
          }),
      )
    ).total,
    0,
  );
  const product = await get(
    '/catalog/products/' + page.items.find((p) => p.images.length)?.slug,
  );
  assert.ok(product.attributes.length > 0);
  assert.ok(product.images.length > 0);
  assert.ok(!('list_price' in product));
  const image = await fetch(
    base + product.images[0].replace('/api/catalog/', '/catalog/'),
  );
  assert.equal(image.status, 200);
  assert.ok(image.headers.get('content-type').startsWith('image/'));
  assert.ok((await image.arrayBuffer()).byteLength > 0);
  assert.equal((await fetch(base + '/catalog/products?limit=999')).status, 400);
  assert.equal(
    (await fetch(base + '/catalog/products/odoo-999999999')).status,
    404,
  );
  assert.equal(
    (await get('/catalog/products?q=' + encodeURIComponent("' OR 1=1 --")))
      .total,
    0,
  );
  const db = app.get(Pool);
  const rows = await db.query(
    'SELECT images FROM atelier_catalog.effective_products WHERE visible',
  );
  const files = new Set(rows.rows.flatMap((p) => p.images));
  for (const file of files)
    await access(
      resolve(
        process.env.CATALOG_STORAGE_DIR || 'storage/catalog',
        'images',
        file,
      ),
    );
  const membership = await db.query(
    'SELECT count(*) AS invalid FROM atelier_catalog.effective_product_collections pc JOIN atelier_catalog.effective_products p ON p.id=pc.product_id JOIN atelier_catalog.collections c ON c.key=pc.collection_key WHERE p.brand_slug<>c.brand_slug',
  );
  assert.equal(Number(membership.rows[0].invalid), 0);
  console.log(
    JSON.stringify({
      httpChecks: 'passed',
      products: page.total,
      brands: facets.brands.length,
      collections: facets.collections.length,
      uniqueLocalPhotos: files.size,
      pagination: 'passed',
      brandCollectionIsolation: 'passed',
      imageDelivery: 'passed',
    }),
  );
} finally {
  await app.close();
}
