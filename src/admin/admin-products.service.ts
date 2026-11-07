import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { parseCatalogQuery } from '../catalog/catalog.service.js';
import {
  IMAGE_NAME,
  validateProductPatch,
  type ProductChanges,
} from './admin.validation.js';

type Row = {
  id: number;
  slug: string;
  name: string;
  sku: string | null;
  description: string;
  brand_slug: string;
  silhouette: string;
  attributes: { name: string; values: string[] }[];
  images: string[];
  visible: boolean;
  collection_keys: string[];
  edit_version?: number;
  overrides?: ProductChanges;
  imported_at: string;
  source_write_date: string;
  variant_count: number;
};
function editable(row: Row) {
  return {
    name: row.name,
    sku: row.sku,
    description: row.description,
    brandSlug: row.brand_slug,
    silhouette: row.silhouette,
    attributes: row.attributes.filter(
      (attribute) => attribute.name.toLowerCase() !== 'silhouette',
    ),
    images: row.images,
    visible: row.visible,
    collectionKeys: row.collection_keys,
  };
}
export function productId(value: string) {
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 1
  )
    throw new NotFoundException('Товар не найден');
  return Number(value);
}

@Injectable()
export class AdminProductsService {
  constructor(@Inject(Pool) private readonly db: Pool) {}

  async list(raw: Record<string, unknown>) {
    const query = parseCatalogQuery(raw);
    if (
      raw.visibility !== undefined &&
      (typeof raw.visibility !== 'string' ||
        !['all', 'visible', 'hidden'].includes(raw.visibility))
    )
      throw new BadRequestException('Недопустимая видимость');
    const params: unknown[] = [];
    const where = ['true'];
    const bind = (v: unknown) => {
      params.push(v);
      return '$' + params.length;
    };
    if (query.q) {
      const term = bind('%' + query.q.replace(/[\\%_]/g, '\\$&') + '%');
      where.push(
        `(p.name ILIKE ${term} OR p.sku ILIKE ${term} OR p.id::text ILIKE ${term})`,
      );
    }
    if (query.brand) where.push('p.brand_slug=' + bind(query.brand));
    if (raw.visibility === 'visible') where.push('p.visible');
    if (raw.visibility === 'hidden') where.push('NOT p.visible');
    const clause = ' WHERE ' + where.join(' AND ');
    const count = await this.db.query(
      'SELECT count(*)::integer AS total FROM atelier_catalog.effective_products p' +
        clause,
      params,
    );
    const rows = await this.db.query(
      `SELECT p.id,p.slug,p.name,p.sku,p.brand_slug AS "brandSlug",b.name AS "brandName",p.visible,p.images,p.edit_version AS version,p.overrides FROM atelier_catalog.effective_products p JOIN atelier_catalog.brands b ON b.slug=p.brand_slug${clause} ORDER BY p.id LIMIT ${bind(query.limit)} OFFSET ${bind((query.page - 1) * query.limit)}`,
      params,
    );
    return {
      items: rows.rows.map((p) => ({
        ...p,
        overriddenFields: Object.keys(p.overrides),
        overrides: undefined,
      })),
      total: count.rows[0].total,
      page: query.page,
      pages: Math.ceil(count.rows[0].total / query.limit),
    };
  }
  async metadata() {
    const [brands, collections] = await Promise.all([
      this.db.query(
        'SELECT slug,name FROM atelier_catalog.brands ORDER BY name',
      ),
      this.db.query(
        'SELECT key,name,brand_slug AS "brandSlug" FROM atelier_catalog.collections ORDER BY name',
      ),
    ]);
    return { brands: brands.rows, collections: collections.rows };
  }
  async get(id: number, db: Pool | PoolClient = this.db) {
    const [effective, source] = await Promise.all([
      db.query<Row>(
        `SELECT p.*,COALESCE((SELECT jsonb_agg(collection_key ORDER BY collection_key) FROM atelier_catalog.effective_product_collections WHERE product_id=p.id),'[]') AS collection_keys FROM atelier_catalog.effective_products p WHERE p.id=$1`,
        [id],
      ),
      db.query<Row>(
        `SELECT p.*,COALESCE((SELECT jsonb_agg(collection_key ORDER BY collection_key) FROM atelier_catalog.product_collections WHERE product_id=p.id),'[]') AS collection_keys FROM atelier_catalog.products p WHERE p.id=$1`,
        [id],
      ),
    ]);
    const row = effective.rows[0];
    if (!row) throw new NotFoundException('Товар не найден');
    return {
      id: row.id,
      slug: row.slug,
      product: editable(row),
      source: editable(source.rows[0]),
      version: row.edit_version ?? 0,
      overriddenFields: Object.keys(row.overrides ?? {}),
      importedAt: row.imported_at,
      sourceWriteDate: row.source_write_date,
      variantCount: row.variant_count,
    };
  }
  async save(id: number, body: unknown, adminId: number) {
    const patch = validateProductPatch(body);
    const db = await this.db.connect();
    try {
      await db.query('BEGIN');
      const locked = await db.query(
        'SELECT id FROM atelier_catalog.products WHERE id=$1 FOR UPDATE',
        [id],
      );
      if (!locked.rows.length) throw new NotFoundException('Товар не найден');
      const current = await this.get(id, db);
      if (current.version !== patch.version)
        throw new ConflictException(
          'Товар изменён в другой вкладке. Обновите страницу перед сохранением',
        );
      const previous = await db.query(
        'SELECT changes FROM atelier_catalog.product_overrides WHERE product_id=$1',
        [id],
      );
      const changes: Record<string, unknown> = {
        ...previous.rows[0]?.changes,
      };
      for (const field of patch.reset) delete changes[field];
      Object.assign(changes, patch.changes);
      const final = { ...current.source, ...changes } as ReturnType<
        typeof editable
      >;
      if (
        !(
          await db.query('SELECT 1 FROM atelier_catalog.brands WHERE slug=$1', [
            final.brandSlug,
          ])
        ).rows.length
      )
        throw new BadRequestException('Бренд не найден');
      if (final.collectionKeys.length) {
        const rows = await db.query(
          'SELECT key FROM atelier_catalog.collections WHERE key=ANY($1::text[]) AND brand_slug=$2',
          [final.collectionKeys, final.brandSlug],
        );
        if (rows.rows.length !== final.collectionKeys.length)
          throw new BadRequestException(
            'Коллекции должны принадлежать выбранному бренду',
          );
      }
      if (final.images.length) {
        const uploaded = await db.query(
          'SELECT filename FROM atelier_catalog.admin_media WHERE filename=ANY($1::text[])',
          [final.images],
        );
        const allowed = new Set([
          ...current.source.images,
          ...current.product.images,
          ...uploaded.rows.map((r) => r.filename),
        ]);
        if (final.images.some((name) => !allowed.has(name)))
          throw new BadRequestException(
            'Используйте фото товара или загрузите новое изображение',
          );
        for (const name of final.images) {
          try {
            await access(
              resolve(
                process.env.CATALOG_STORAGE_DIR || 'storage/catalog',
                'images',
                name,
              ),
            );
          } catch {
            throw new BadRequestException('Файл изображения отсутствует');
          }
        }
      }
      await db.query(
        `INSERT INTO atelier_catalog.product_overrides(product_id,changes,version,updated_by) VALUES($1,$2::jsonb,1,$3) ON CONFLICT(product_id) DO UPDATE SET changes=EXCLUDED.changes,version=atelier_catalog.product_overrides.version+1,updated_by=EXCLUDED.updated_by,updated_at=now()`,
        [id, JSON.stringify(changes), adminId],
      );
      const result = await this.get(id, db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }
  async upload(file: Express.Multer.File | undefined, adminId: number) {
    if (!file || file.size > 8 * 1024 * 1024)
      throw new BadRequestException(
        'Выберите фото JPEG, PNG или WebP размером до 8 МБ',
      );
    let output: Buffer;
    try {
      const image = sharp(file.buffer, {
        limitInputPixels: 40000000,
        animated: false,
      });
      const metadata = await image.metadata();
      if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? ''))
        throw new Error('Unsupported');
      output = await image
        .rotate()
        .resize({
          width: 1920,
          height: 1920,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 90 })
        .toBuffer();
    } catch {
      throw new BadRequestException(
        'Неверное изображение. Допустимы JPEG, PNG и WebP',
      );
    }
    const filename =
      createHash('sha256').update(output).digest('hex') + '.webp';
    const folder = resolve(
      process.env.CATALOG_STORAGE_DIR || 'storage/catalog',
      'images',
    );
    await mkdir(folder, { recursive: true });
    try {
      await writeFile(resolve(folder, filename), output, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    await this.db.query(
      'INSERT INTO atelier_catalog.admin_media(filename,uploaded_by) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [filename, adminId],
    );
    return { filename };
  }
  async imageExists(filename: string) {
    if (!IMAGE_NAME.test(filename))
      throw new NotFoundException('Фото не найдено');
    const result = await this.db.query(
      `SELECT 1 FROM atelier_catalog.effective_products WHERE images @> $1::jsonb UNION ALL SELECT 1 FROM atelier_catalog.products WHERE images @> $1::jsonb UNION ALL SELECT 1 FROM atelier_catalog.admin_media WHERE filename=$2 LIMIT 1`,
      [JSON.stringify([filename]), filename],
    );
    if (!result.rows.length) throw new NotFoundException('Фото не найдено');
  }
}
