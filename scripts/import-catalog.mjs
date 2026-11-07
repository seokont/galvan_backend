import { loadEnvFile } from 'node:process';
import { readFile, writeFile, mkdir, access, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { OdooReader } from './lib/odoo-readonly.mjs';
import { mapProduct, validateBrandNames } from './lib/catalog-mapping.mjs';
import { migrate } from './lib/migrations.mjs';

loadEnvFile('.env');
if (!process.env.DATABASE_URL) throw new Error('Missing DATABASE_URL');
const reader = new OdooReader({
  url: process.env.ODOO_URL,
  database: process.env.ODOO_DATABASE,
  key: process.env.ODOO_API_KEY,
});
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
const storage = resolve(process.env.CATALOG_STORAGE_DIR || 'storage/catalog');
const imagesDir = resolve(storage, 'images');
await mkdir(imagesDir, { recursive: true });
let manifest = {};
try {
  manifest = JSON.parse(
    await readFile(resolve(storage, 'manifest.json'), 'utf8'),
  );
} catch {
  /* First import */
}

function imageExtension(bytes) {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'png';
  if (
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'webp';
  if (bytes.toString('ascii', 0, 3) === 'GIF') return 'gif';
  return null;
}
async function saveImage(base64) {
  if (!base64) return null;
  const bytes = Buffer.from(base64, 'base64');
  const ext = imageExtension(bytes);
  if (!ext) throw new Error('Unsupported image type; import aborted');
  const name = `${createHash('sha256').update(bytes).digest('hex')}.${ext}`;
  try {
    await access(resolve(imagesDir, name));
  } catch {
    await writeFile(resolve(imagesDir, name), bytes, { flag: 'wx' });
  }
  return name;
}
async function copyPhotos(model, records) {
  const result = new Map();
  const missing = [];
  for (const record of records) {
    const key = `${model}:${record.id}:${record.write_date}`;
    const cached = manifest[key];
    if (cached !== undefined) {
      try {
        if (cached) await access(resolve(imagesDir, cached));
        result.set(record.id, cached);
        continue;
      } catch {
        /* Recover missing cache */
      }
    }
    missing.push(record);
  }
  for (let i = 0; i < missing.length; i += 20) {
    const batch = missing.slice(i, i + 20);
    const rows = await reader.call(model, 'search_read', {
      domain: [['id', 'in', batch.map((r) => r.id)]],
      fields: ['id', 'image_1024'],
      limit: batch.length,
    });
    if (rows.length !== batch.length)
      throw new Error('Source photos changed during import; retry');
    for (const row of rows) {
      const name = await saveImage(row.image_1024);
      result.set(row.id, name);
      manifest[
        `${model}:${row.id}:${batch.find((r) => r.id === row.id).write_date}`
      ] = name;
    }
    await writeFile(
      resolve(storage, 'manifest.json.tmp'),
      JSON.stringify(manifest),
    );
    await rename(
      resolve(storage, 'manifest.json.tmp'),
      resolve(storage, 'manifest.json'),
    );
    if (i % 200 === 0)
      console.log(
        `Photos ${model}: ${Math.min(i + 20, missing.length)}/${missing.length}`,
      );
  }
  return result;
}

let db;
try {
  db = await pool.connect();
  const locked = await db.query(
    'SELECT pg_try_advisory_lock(74182016) AS locked',
  );
  if (!locked.rows[0].locked)
    throw new Error('Another catalog import is running');
  await migrate(db);
  const domain = [
    ['active', '=', true],
    ['sale_ok', '=', true],
    ['is_published', '=', true],
    ['x_brand', '!=', false],
    ['x_brand', '!=', 'No Brand'],
  ];
  const raw = await reader.all('product.template', domain, [
    'name',
    'default_code',
    'x_brand',
    'categ_id',
    'public_categ_ids',
    'attribute_line_ids',
    'product_variant_ids',
    'product_template_image_ids',
    'write_date',
    'public_description',
    'website_description',
  ]);
  if (!raw.length)
    throw new Error('No eligible products; existing catalog preserved');
  console.log(`Eligible published products: ${raw.length}`);
  validateBrandNames(raw.map((p) => p.x_brand));
  const categoryRows = await reader.all(
    'product.public.category',
    [],
    ['name', 'parent_id'],
  );
  const categories = new Map(categoryRows.map((c) => [c.id, c]));
  const lines = [];
  for (let i = 0; i < raw.length; i += 100)
    lines.push(
      ...(await reader.all(
        'product.template.attribute.line',
        [['product_tmpl_id', 'in', raw.slice(i, i + 100).map((p) => p.id)]],
        ['product_tmpl_id', 'attribute_id', 'value_ids'],
      )),
    );
  const values = new Map(
    (await reader.all('product.attribute.value', [], ['name'])).map((v) => [
      v.id,
      v.name,
    ]),
  );
  const attrs = new Map();
  for (const line of lines) {
    const id = line.product_tmpl_id[0];
    const list = attrs.get(id) ?? [];
    list.push({
      name: line.attribute_id[1],
      values: line.value_ids.map((id) => values.get(id)).filter(Boolean),
    });
    attrs.set(id, list);
  }
  const products = raw.map((p) =>
    mapProduct(p, categories, attrs.get(p.id) ?? []),
  );
  const primaryPhotos = await copyPhotos('product.template', raw);
  const media = [];
  for (let i = 0; i < raw.length; i += 100)
    media.push(
      ...(await reader.all(
        'product.image',
        [['product_tmpl_id', 'in', raw.slice(i, i + 100).map((p) => p.id)]],
        ['product_tmpl_id', 'sequence', 'write_date', 'video_url'],
      )),
    );
  const imageMedia = media.filter((m) => !m.video_url);
  const galleryPhotos = await copyPhotos('product.image', imageMedia);
  for (const p of products) {
    p.images = [
      primaryPhotos.get(p.id),
      ...imageMedia
        .filter((m) => m.product_tmpl_id[0] === p.id)
        .sort((a, b) => a.sequence - b.sequence || a.id - b.id)
        .map((m) => galleryPhotos.get(m.id)),
    ].filter(Boolean);
    p.images = [...new Set(p.images)];
  }
  await db.query('BEGIN');
  for (const p of products) {
    await db.query(
      'INSERT INTO atelier_catalog.brands(slug,name) VALUES($1,$2) ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name',
      [p.brand.slug, p.brand.name],
    );
    await db.query(
      `INSERT INTO atelier_catalog.products(id,slug,legacy_slug,name,sku,brand_slug,silhouette,description,attributes,images,category_path,category_paths,variant_count,source_write_date)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12::jsonb,$13,$14)
      ON CONFLICT(id) DO UPDATE SET slug=EXCLUDED.slug,legacy_slug=EXCLUDED.legacy_slug,name=EXCLUDED.name,sku=EXCLUDED.sku,brand_slug=EXCLUDED.brand_slug,silhouette=EXCLUDED.silhouette,description=EXCLUDED.description,attributes=EXCLUDED.attributes,images=EXCLUDED.images,category_path=EXCLUDED.category_path,category_paths=EXCLUDED.category_paths,variant_count=EXCLUDED.variant_count,source_write_date=EXCLUDED.source_write_date,visible=true,imported_at=now()`,
      [
        p.id,
        p.slug,
        p.legacySlug,
        p.name,
        p.sku,
        p.brand.slug,
        p.silhouette,
        p.description,
        JSON.stringify(p.attributes),
        JSON.stringify(p.images),
        p.categoryPath,
        JSON.stringify(p.categoryPaths),
        p.variantCount,
        p.writeDate,
      ],
    );
    await db.query(
      'DELETE FROM atelier_catalog.product_collections WHERE product_id=$1',
      [p.id],
    );
    for (const c of p.collections) {
      await db.query(
        'INSERT INTO atelier_catalog.collections(key,brand_slug,name,odoo_id) VALUES($1,$2,$3,$4) ON CONFLICT(key) DO UPDATE SET name=EXCLUDED.name',
        [c.key, c.brandSlug, c.name, c.odooId],
      );
      await db.query(
        'INSERT INTO atelier_catalog.product_collections(product_id,collection_key) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [p.id, c.key],
      );
    }
  }
  await db.query(
    'UPDATE atelier_catalog.products SET visible=false WHERE NOT(id=ANY($1::integer[]))',
    [products.map((p) => p.id)],
  );
  await db.query('COMMIT');
  console.log(
    JSON.stringify({
      imported: products.length,
      brands: new Set(products.map((p) => p.brand.slug)).size,
      collections: new Set(
        products.flatMap((p) => p.collections.map((c) => c.key)),
      ).size,
      photos: products.reduce((n, p) => n + p.images.length, 0),
      withoutPhotos: products.filter((p) => !p.images.length).length,
      odooMode: 'READ ONLY',
    }),
  );
} catch (error) {
  if (db) await db.query('ROLLBACK').catch(() => {});
  const safe =
    /^(Odoo |No eligible|Another catalog|Unsupported image|Source photos)/.test(
      error.message,
    );
  console.error(
    safe
      ? error.message
      : 'Catalog import failed. Check local database and configuration; existing catalog preserved.',
  );
  process.exitCode = 1;
} finally {
  if (db) {
    await db.query('SELECT pg_advisory_unlock(74182016)').catch(() => {});
    db.release();
  }
  await pool.end();
}
