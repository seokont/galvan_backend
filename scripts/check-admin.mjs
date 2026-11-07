import 'reflect-metadata';
import { loadEnvFile } from 'node:process';
import { randomInt } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
loadEnvFile('.env');
const { AppModule } = await import('../dist/app.module.js');
const { sessionHash } = await import('../dist/admin/password.js');
const app = await NestFactory.create(AppModule, { logger: false });
const id = 2000000000 + randomInt(1000000);
const slug = 'odoo-' + id;
const tokens = [];
const media = [];
let db;
try {
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  db = app.get(Pool);
  async function req(method, path, body, token, status = 200) {
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body && !(body instanceof FormData))
      headers['Content-Type'] = 'application/json';
    const response = await fetch(base + path, {
      method,
      headers,
      body:
        body instanceof FormData
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
    });
    assert.equal(response.status, status, method + ' ' + path);
    return response;
  }
  await req('GET', '/admin/products', null, null, 401);
  await req(
    'PATCH',
    '/admin/products/' + id,
    { version: 0, changes: { name: 'forbidden' } },
    null,
    401,
  );
  await req('GET', '/admin/metadata', null, null, 401);
  await req(
    'POST',
    '/admin/auth/login',
    { email: process.env.ADMIN_EMAIL, password: 'wrong-password' },
    null,
    401,
  );
  const login = await (
    await req(
      'POST',
      '/admin/auth/login',
      {
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_INITIAL_PASSWORD,
      },
      null,
      201,
    )
  ).json();
  const token = login.token;
  tokens.push(token);
  assert.ok(login.admin.id);
  await req('GET', '/admin/auth/session', null, token);
  const sample = (
    await db.query(
      `SELECT p.* FROM atelier_catalog.products p WHERE p.brand_slug='galvan' AND jsonb_array_length(p.images)>0 LIMIT 1`,
    )
  ).rows[0];
  const collection = (
    await db.query(
      'SELECT key FROM atelier_catalog.collections WHERE brand_slug=$1 LIMIT 1',
      [sample.brand_slug],
    )
  ).rows[0].key;
  await db.query(
    `INSERT INTO atelier_catalog.products(id,slug,name,brand_slug,silhouette,description,attributes,images,visible) VALUES($1,$2,'Admin verification fixture',$3,'Princess','Source description','[]',$4::jsonb,false)`,
    [id, slug, sample.brand_slug, JSON.stringify(sample.images.slice(0, 2))],
  );
  await db.query(
    'INSERT INTO atelier_catalog.product_collections(product_id,collection_key) VALUES($1,$2)',
    [id, collection],
  );
  const original = await (
    await req('GET', '/admin/products/' + id, null, token)
  ).json();
  assert.equal(original.version, 0);
  const saved = await (
    await req(
      'PATCH',
      '/admin/products/' + id,
      {
        version: 0,
        changes: {
          name: 'Manual verification name',
          visible: true,
          attributes: [
            { name: 'Color', values: ['ivory'] },
            { name: 'Size', values: ['38', '40'] },
          ],
        },
        reset: [],
      },
      token,
    )
  ).json();
  assert.equal(saved.version, 1);
  await db.query(
    `UPDATE atelier_catalog.products SET name='Latest Odoo name',description='Latest Odoo description',attributes='[{"name":"Color","values":["nude"]}]'::jsonb WHERE id=$1`,
    [id],
  );
  const publicProduct = await (
    await req('GET', '/catalog/products/' + slug, null, null)
  ).json();
  assert.equal(publicProduct.name, 'Manual verification name');
  assert.equal(publicProduct.description, 'Latest Odoo description');
  assert.equal(publicProduct.attributes[0].values[0], 'ivory');
  await req(
    'PATCH',
    '/admin/products/' + id,
    { version: 0, changes: { name: 'Stale overwrite' } },
    token,
    409,
  );
  const reset = await (
    await req(
      'PATCH',
      '/admin/products/' + id,
      { version: 1, changes: {}, reset: ['name'] },
      token,
    )
  ).json();
  assert.equal(reset.product.name, 'Latest Odoo name');
  assert.equal(reset.version, 2);
  const other = (
    await db.query(
      'SELECT key FROM atelier_catalog.collections WHERE brand_slug<>$1 LIMIT 1',
      [sample.brand_slug],
    )
  ).rows[0].key;
  await req(
    'PATCH',
    '/admin/products/' + id,
    { version: 2, changes: { collectionKeys: [other] } },
    token,
    400,
  );
  const invalid = new FormData();
  invalid.append(
    'file',
    new Blob(['<svg/>'], { type: 'image/svg+xml' }),
    'fake.svg',
  );
  await req('POST', '/admin/media', invalid, token, 400);
  const image = await sharp({
    create: {
      width: 40,
      height: 60,
      channels: 3,
      background: { r: randomInt(255), g: randomInt(255), b: randomInt(255) },
    },
  })
    .png()
    .toBuffer();
  const form = new FormData();
  form.append('file', new Blob([image], { type: 'image/png' }), 'test.png');
  const uploaded = await (
    await req('POST', '/admin/media', form, token, 201)
  ).json();
  media.push(uploaded.filename);
  assert.match(uploaded.filename, /^[a-f0-9]{64}\.webp$/);
  const hidden = await (
    await req(
      'PATCH',
      '/admin/products/' + id,
      {
        version: 2,
        changes: {
          images: [uploaded.filename, ...original.product.images],
          visible: false,
        },
      },
      token,
    )
  ).json();
  assert.equal(hidden.product.images[0], uploaded.filename);
  assert.equal(hidden.version, 3);
  await req('GET', '/catalog/products/' + slug, null, null, 404);
  await req('GET', '/admin/images/' + uploaded.filename, null, token);
  await req('GET', '/catalog/images/' + uploaded.filename, null, null, 404);
  const restored = await (
    await req(
      'PATCH',
      '/admin/products/' + id,
      {
        version: 3,
        changes: {},
        reset: [
          'name',
          'sku',
          'description',
          'brandSlug',
          'silhouette',
          'attributes',
          'collectionKeys',
          'images',
          'visible',
        ],
      },
      token,
    )
  ).json();
  assert.deepEqual(restored.overriddenFields, []);
  assert.equal(restored.product.name, 'Latest Odoo name');
  assert.equal(restored.product.attributes[0].values[0], 'nude');
  await req('POST', '/admin/auth/logout', {}, token, 201);
  await req('GET', '/admin/auth/session', null, token, 401);
  const expired = await (
    await req(
      'POST',
      '/admin/auth/login',
      {
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_INITIAL_PASSWORD,
      },
      null,
      201,
    )
  ).json();
  tokens.push(expired.token);
  await db.query(
    "UPDATE atelier_catalog.admin_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
    [sessionHash(expired.token)],
  );
  await req('GET', '/admin/auth/session', null, expired.token, 401);
  await req(
    'POST',
    '/admin/auth/login',
    { email: process.env.ADMIN_EMAIL, password: 'wrong' },
    null,
    401,
  );
  await req(
    'POST',
    '/admin/auth/login',
    { email: process.env.ADMIN_EMAIL, password: 'wrong' },
    null,
    401,
  );
  await req(
    'POST',
    '/admin/auth/login',
    { email: process.env.ADMIN_EMAIL, password: 'wrong' },
    null,
    429,
  );
  console.log(
    'Admin integration passed: protected routes, login/logout/expiry/throttling, save, source sync simulation, field reset, conflict, collection validation, upload, hidden media.',
  );
} finally {
  if (db) {
    await db.query(
      'DELETE FROM atelier_catalog.product_overrides WHERE product_id=$1',
      [id],
    );
    await db.query(
      'DELETE FROM atelier_catalog.product_collections WHERE product_id=$1',
      [id],
    );
    await db.query('DELETE FROM atelier_catalog.products WHERE id=$1', [id]);
    for (const filename of media) {
      const used=await db.query('SELECT 1 FROM atelier_catalog.effective_products WHERE images @> $1::jsonb UNION ALL SELECT 1 FROM atelier_catalog.products WHERE images @> $1::jsonb LIMIT 1',[JSON.stringify([filename])]);
      if(used.rows.length) continue;
      await db.query(
        'DELETE FROM atelier_catalog.admin_media WHERE filename=$1',
        [filename],
      );
      await unlink(
        resolve(
          process.env.CATALOG_STORAGE_DIR || 'storage/catalog',
          'images',
          filename,
        ),
      ).catch(() => {});
    }
    for (const token of tokens)
      await db.query(
        'DELETE FROM atelier_catalog.admin_sessions WHERE token_hash=$1',
        [sessionHash(token)],
      );
  }
  await app.close();
}
