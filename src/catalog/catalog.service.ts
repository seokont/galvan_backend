import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Pool } from 'pg';

export function parseCatalogQuery(query: Record<string, unknown>) {
  function text(key: string, max: number) {
    const value = query[key];
    if (value === undefined) return '';
    if (typeof value !== 'string' || value.length > max)
      throw new BadRequestException(`Invalid ${key}`);
    return value.trim();
  }
  function integer(key: string, fallback: number, max: number) {
    const value = text(key, 10);
    if (!value) return fallback;
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max)
      throw new BadRequestException(`Invalid ${key}`);
    return Number(value);
  }
  return {
    page: integer('page', 1, 100000),
    limit: integer('limit', 24, 60),
    brand: text('brand', 80),
    collection: text('collection', 160),
    silhouette: text('silhouette', 100),
    q: text('q', 100),
  };
}

type ProductRow = {
  id: number;
  slug: string;
  name: string;
  sku: string | null;
  brand_slug: string;
  brand_name: string;
  silhouette: string;
  description: string;
  attributes: { name: string; values: string[] }[];
  images: string[];
  variant_count: number;
  collections: { key: string; name: string }[];
};
const SELECT = `SELECT p.*, b.name AS brand_name,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('key',c.key,'name',c.name) ORDER BY c.name)
    FROM atelier_catalog.effective_product_collections pc JOIN atelier_catalog.collections c ON c.key=pc.collection_key WHERE pc.product_id=p.id),'[]'::jsonb) AS collections
  FROM atelier_catalog.effective_products p JOIN atelier_catalog.brands b ON b.slug=p.brand_slug`;

function publicProduct(row: ProductRow, detail = false) {
  const attributes = row.attributes.flatMap((attribute) =>
    attribute.name.toLowerCase() === 'silhouette'
      ? row.silhouette
        ? [{ ...attribute, values: [row.silhouette] }]
        : []
      : [attribute],
  );
  if (
    row.silhouette &&
    !attributes.some((a) => a.name.toLowerCase() === 'silhouette')
  )
    attributes.push({ name: 'Silhouette', values: [row.silhouette] });
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    sku: row.sku,
    brand: { slug: row.brand_slug, name: row.brand_name },
    collections: row.collections ?? [],
    silhouette: row.silhouette,
    images: (detail ? row.images : row.images.slice(0, 1)).map(
      (name) => `/api/catalog/images/${name}`,
    ),
    ...(detail
      ? {
          description: row.description,
          attributes,
          variantCount: row.variant_count,
        }
      : {}),
  };
}

@Injectable()
export class CatalogService {
  constructor(@Inject(Pool) private readonly pool: Pool) {}

  async list(raw: Record<string, unknown>) {
    const query = parseCatalogQuery(raw);
    const params: unknown[] = [];
    const where = ['p.visible=true'];
    const bind = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    if (query.brand) where.push(`p.brand_slug=${bind(query.brand)}`);
    if (query.collection)
      where.push(
        `EXISTS (SELECT 1 FROM atelier_catalog.effective_product_collections pc WHERE pc.product_id=p.id AND pc.collection_key=${bind(query.collection)})`,
      );
    if (query.silhouette) where.push(`p.silhouette=${bind(query.silhouette)}`);
    if (query.q)
      where.push(
        `p.name ILIKE ${bind(`%${query.q.replace(/[\\%_]/g, '\\$&')}%`)}`,
      );
    const clause = ` WHERE ${where.join(' AND ')}`;
    const count = await this.pool.query<{ total: string }>(
      `SELECT count(*) AS total FROM atelier_catalog.effective_products p${clause}`,
      params,
    );
    const total = Number(count.rows[0].total);
    const rows = await this.pool.query<ProductRow>(
      `${SELECT}${clause} ORDER BY b.name,p.name,p.id LIMIT ${bind(query.limit)} OFFSET ${bind((query.page - 1) * query.limit)}`,
      params,
    );
    return {
      items: rows.rows.map((row) => publicProduct(row)),
      total,
      page: query.page,
      limit: query.limit,
      pages: Math.ceil(total / query.limit),
    };
  }

  async detail(slug: string) {
    if (!/^[a-z0-9-]{1,100}$/.test(slug))
      throw new NotFoundException('Product not found');
    const result = await this.pool.query<ProductRow>(
      `${SELECT} WHERE p.visible=true AND (p.slug=$1 OR EXISTS (SELECT 1 FROM atelier_catalog.product_slug_aliases a WHERE a.product_id=p.id AND a.slug=$1)) ORDER BY p.id LIMIT 1`,
      [slug],
    );
    if (!result.rows[0]) throw new NotFoundException('Product not found');
    return publicProduct(result.rows[0], true);
  }

  async facets() {
    const [brands, collections, silhouettes] = await Promise.all([
      this.pool.query(
        `SELECT b.slug,b.name,count(*)::integer AS count FROM atelier_catalog.brands b JOIN atelier_catalog.effective_products p ON p.brand_slug=b.slug AND p.visible GROUP BY b.slug,b.name ORDER BY b.name`,
      ),
      this.pool.query(
        `SELECT c.key,c.name,c.brand_slug AS "brandSlug",count(*)::integer AS count FROM atelier_catalog.collections c JOIN atelier_catalog.effective_product_collections pc ON pc.collection_key=c.key JOIN atelier_catalog.effective_products p ON p.id=pc.product_id AND p.visible GROUP BY c.key,c.name,c.brand_slug ORDER BY c.name`,
      ),
      this.pool.query(
        `SELECT silhouette AS name,count(*)::integer AS count FROM atelier_catalog.effective_products WHERE visible AND silhouette<>'' GROUP BY silhouette ORDER BY silhouette`,
      ),
    ]);
    return {
      brands: brands.rows,
      collections: collections.rows,
      silhouettes: silhouettes.rows,
    };
  }

  async imageExists(filename: string) {
    if (!/^[a-f0-9]{64}\.(jpg|png|webp|gif)$/.test(filename))
      throw new NotFoundException('Image not found');
    const result = await this.pool.query(
      'SELECT 1 FROM atelier_catalog.effective_products WHERE visible AND images @> $1::jsonb LIMIT 1',
      [JSON.stringify([filename])],
    );
    if (!result.rows.length) throw new NotFoundException('Image not found');
  }
}
