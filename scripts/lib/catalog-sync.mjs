import {
  readFile,
  writeFile,
  mkdir,
  stat,
  rename,
  unlink,
} from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { mapProduct, validateBrandNames } from './catalog-mapping.mjs';
import { migrate } from './migrations.mjs';

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, ordered(value[key])]),
    );
  return value;
}
export function catalogSnapshot(p) {
  return JSON.stringify(
    ordered({
      id: p.id,
      slug: p.slug,
      legacySlug: p.legacySlug,
      name: p.name,
      sku: p.sku,
      brand: p.brand,
      collections: [...p.collections].sort((a, b) =>
        a.key.localeCompare(b.key),
      ),
      categoryPaths: p.categoryPaths,
      categoryPath: p.categoryPath,
      attributes: p.attributes,
      silhouette: p.silhouette,
      description: p.description,
      variantCount: p.variantCount,
      images: p.images,
    }),
  );
}
export function changedProduct(previous, next) {
  return catalogSnapshot(previous) !== catalogSnapshot(next);
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
  throw new Error('Unsupported image type; import aborted');
}
export async function syncCatalog({
  pool,
  reader,
  storage,
  onProgress = async () => {},
  onComplete = async () => {},
}) {
  storage = resolve(storage);
  const imagesDir = resolve(storage, 'images');
  const stats = {
    total: 0,
    checked: 0,
    added: 0,
    updated: 0,
    unchanged: 0,
    photosDone: 0,
    photosTotal: 0,
    photosDownloaded: 0,
  };
  const emit = (phase, currentModel = '') =>
    onProgress({ phase, stats: { ...stats }, currentModel });
  const db = await pool.connect();
  let locked = false,
    inTransaction = false;
  try {
    locked = (await db.query('SELECT pg_try_advisory_lock(74182016) AS locked'))
      .rows[0].locked;
    if (!locked) throw new Error('Another catalog import is running');
    await migrate(db);
    await mkdir(imagesDir, { recursive: true });
    let manifest = {};
    try {
      manifest = JSON.parse(
        await readFile(resolve(storage, 'manifest.json'), 'utf8'),
      );
    } catch (error) {
      if (error.code !== 'ENOENT')
        throw new Error('Catalog image manifest cannot be read');
    }
    async function validImageFile(name) {
      if (!/^[a-f0-9]{64}\.(jpg|png|webp|gif)$/.test(name)) return false;
      try {
        const file = resolve(imagesDir, name),
          info = await stat(file);
        if (!info.size || info.size > 20 * 1024 * 1024) return false;
        const bytes = await readFile(file);
        return (
          createHash('sha256').update(bytes).digest('hex') ===
            name.split('.')[0] && imageExtension(bytes) === name.split('.')[1]
        );
      } catch {
        return false;
      }
    }
    async function saveImage(base64) {
      if (!base64) return null;
      const bytes = Buffer.from(base64, 'base64');
      if (bytes.length > 20 * 1024 * 1024)
        throw new Error('Unsupported image size; import aborted');
      const name =
        createHash('sha256').update(bytes).digest('hex') +
        '.' +
        imageExtension(bytes);
      if (await validImageFile(name)) return name;
      const temporary = resolve(imagesDir, '.sync-' + randomUUID() + '.tmp');
      try {
        await writeFile(temporary, bytes, { flag: 'wx' });
        await rename(temporary, resolve(imagesDir, name));
      } finally {
        await unlink(temporary).catch(() => {});
      }
      return name;
    }
    async function copyPhotos(model, records) {
      const result = new Map(),
        missing = [];
      for (const record of records) {
        const cached = manifest[`${model}:${record.id}:${record.write_date}`];
        if (cached !== undefined) {
          try {
            if (cached && !(await validImageFile(cached)))
              throw new Error('Recover invalid cached photo');
            result.set(record.id, cached);
            stats.photosDone++;
            continue;
          } catch {
            /* Recover missing cached file. */
          }
        }
        missing.push(record);
      }
      await emit('photos');
      for (let i = 0; i < missing.length; i += 20) {
        const batch = missing.slice(i, i + 20),
          ids = new Set(batch.map((r) => r.id));
        const rows = await reader.call(model, 'search_read', {
          domain: [['id', 'in', [...ids]]],
          fields: ['id', 'image_1024'],
          limit: batch.length,
        });
        if (
          rows.length !== batch.length ||
          new Set(rows.map((r) => r.id)).size !== batch.length ||
          rows.some((r) => !ids.has(r.id))
        )
          throw new Error('Source photos changed during import; retry');
        for (const row of rows) {
          const name = await saveImage(row.image_1024);
          result.set(row.id, name);
          manifest[
            `${model}:${row.id}:${batch.find((r) => r.id === row.id).write_date}`
          ] = name;
          stats.photosDone++;
          if (name) stats.photosDownloaded++;
        }
        await writeFile(
          resolve(storage, 'manifest.json.tmp'),
          JSON.stringify(manifest),
        );
        await rename(
          resolve(storage, 'manifest.json.tmp'),
          resolve(storage, 'manifest.json'),
        );
        await emit('photos');
      }
      return result;
    }
    await emit('reading');
    const raw = await reader.all(
      'product.template',
      [
        ['active', '=', true],
        ['sale_ok', '=', true],
        ['is_published', '=', true],
        ['x_brand', '!=', false],
        ['x_brand', '!=', 'No Brand'],
      ],
      [
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
      ],
    );
    if (!raw.length)
      throw new Error('No eligible products; existing catalog preserved');
    stats.total = raw.length;
    validateBrandNames(raw.map((p) => p.x_brand));
    await emit('metadata');
    const categories = new Map(
      (
        await reader.all('product.public.category', [], ['name', 'parent_id'])
      ).map((c) => [c.id, c]),
    );
    const lines = [],
      media = [];
    for (let i = 0; i < raw.length; i += 100) {
      const domain = [
        ['product_tmpl_id', 'in', raw.slice(i, i + 100).map((p) => p.id)],
      ];
      lines.push(
        ...(await reader.all('product.template.attribute.line', domain, [
          'product_tmpl_id',
          'attribute_id',
          'value_ids',
        ])),
      );
      media.push(
        ...(await reader.all('product.image', domain, [
          'product_tmpl_id',
          'sequence',
          'write_date',
          'video_url',
        ])),
      );
      await emit('metadata');
    }
    const values = new Map(
      (await reader.all('product.attribute.value', [], ['name'])).map((v) => [
        v.id,
        v.name,
      ]),
    );
    const attrs = new Map();
    for (const line of lines) {
      const id = line.product_tmpl_id[0],
        list = attrs.get(id) ?? [];
      list.push({
        name: line.attribute_id[1],
        values: line.value_ids.map((id) => values.get(id)).filter(Boolean),
      });
      attrs.set(id, list);
    }
    const products = raw.map((p) =>
      mapProduct(p, categories, attrs.get(p.id) ?? []),
    );
    const imageMedia = media.filter((m) => !m.video_url);
    stats.photosTotal = raw.length + imageMedia.length;
    const primaryPhotos = await copyPhotos('product.template', raw),
      galleryPhotos = await copyPhotos('product.image', imageMedia);
    for (const p of products)
      p.images = [
        ...new Set(
          [
            primaryPhotos.get(p.id),
            ...imageMedia
              .filter((m) => m.product_tmpl_id[0] === p.id)
              .sort((a, b) => a.sequence - b.sequence || a.id - b.id)
              .map((m) => galleryPhotos.get(m.id)),
          ].filter(Boolean),
        ),
      ];
    const existingRows = (
      await db.query(
        `SELECT p.*,b.name AS brand_name,COALESCE((SELECT jsonb_agg(jsonb_build_object('key',c.key,'brandSlug',c.brand_slug,'name',c.name,'odooId',c.odoo_id)) FROM atelier_catalog.product_collections pc JOIN atelier_catalog.collections c ON c.key=pc.collection_key WHERE pc.product_id=p.id),'[]'::jsonb) AS collections FROM atelier_catalog.products p JOIN atelier_catalog.brands b ON b.slug=p.brand_slug`,
      )
    ).rows;
    const existing = new Map(
      existingRows.map((p) => [
        p.id,
        {
          id: p.id,
          slug: p.slug,
          legacySlug: p.legacy_slug,
          name: p.name,
          sku: p.sku,
          brand: { slug: p.brand_slug, name: p.brand_name },
          collections: p.collections,
          categoryPaths: p.category_paths,
          categoryPath: p.category_path,
          attributes: p.attributes,
          silhouette: p.silhouette,
          description: p.description,
          variantCount: p.variant_count,
          images: p.images,
          visible: p.visible,
        },
      ]),
    );
    const mutations = [];
    for (const p of products) {
      const previous = existing.get(p.id);
      if (!previous) {
        stats.added++;
        mutations.push({ ...p, kind: 'added' });
      } else if (previous.visible === false || changedProduct(previous, p)) {
        stats.updated++;
        mutations.push({ ...p, kind: 'updated' });
      } else stats.unchanged++;
      stats.checked++;
      if (stats.checked % 50 === 0 || stats.checked === stats.total)
        await emit('comparing', p.name);
    }
    if (mutations.length) {
      await emit('publishing');
      await db.query('BEGIN');
      inTransaction = true;
      for (const p of mutations) {
        await db.query(
          'INSERT INTO atelier_catalog.brands(slug,name) VALUES($1,$2) ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name WHERE brands.name IS DISTINCT FROM EXCLUDED.name',
          [p.brand.slug, p.brand.name],
        );
        await db.query(
          `INSERT INTO atelier_catalog.products(id,slug,legacy_slug,name,sku,brand_slug,silhouette,description,attributes,images,category_path,category_paths,variant_count,source_write_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12::jsonb,$13,$14) ON CONFLICT(id) DO UPDATE SET slug=EXCLUDED.slug,legacy_slug=EXCLUDED.legacy_slug,name=EXCLUDED.name,sku=EXCLUDED.sku,brand_slug=EXCLUDED.brand_slug,silhouette=EXCLUDED.silhouette,description=EXCLUDED.description,attributes=EXCLUDED.attributes,images=EXCLUDED.images,category_path=EXCLUDED.category_path,category_paths=EXCLUDED.category_paths,variant_count=EXCLUDED.variant_count,source_write_date=EXCLUDED.source_write_date,visible=true,imported_at=now()`,
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
            'INSERT INTO atelier_catalog.collections(key,brand_slug,name,odoo_id) VALUES($1,$2,$3,$4) ON CONFLICT(key) DO UPDATE SET name=EXCLUDED.name WHERE collections.name IS DISTINCT FROM EXCLUDED.name',
            [c.key, c.brandSlug, c.name, c.odooId],
          );
          await db.query(
            'INSERT INTO atelier_catalog.product_collections(product_id,collection_key) VALUES($1,$2) ON CONFLICT DO NOTHING',
            [p.id, c.key],
          );
        }
      }
      await emit('publishing');
    }
    if (!inTransaction) {
      await db.query('BEGIN');
      inTransaction = true;
    }
    const result = {
      ...stats,
      models: mutations
        .slice(0, 50)
        .map((p) => ({ id: p.id, name: p.name, kind: p.kind })),
      odooMode: 'READ ONLY',
    };
    await onComplete(result, db);
    await db.query('COMMIT');
    inTransaction = false;
    return result;
  } catch (error) {
    if (inTransaction) await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (locked)
      await db.query('SELECT pg_advisory_unlock(74182016)').catch(() => {});
    db.release();
  }
}
