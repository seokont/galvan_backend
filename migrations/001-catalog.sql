CREATE SCHEMA IF NOT EXISTS atelier_catalog;
CREATE TABLE IF NOT EXISTS atelier_catalog.brands (
  slug text PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE IF NOT EXISTS atelier_catalog.collections (
  key text PRIMARY KEY,
  brand_slug text NOT NULL REFERENCES atelier_catalog.brands(slug),
  name text NOT NULL,
  odoo_id integer NOT NULL
);
CREATE TABLE IF NOT EXISTS atelier_catalog.products (
  id integer PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  legacy_slug text,
  name text NOT NULL,
  sku text,
  brand_slug text NOT NULL REFERENCES atelier_catalog.brands(slug),
  silhouette text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  attributes jsonb NOT NULL DEFAULT '[]',
  images jsonb NOT NULL DEFAULT '[]',
  category_path text NOT NULL DEFAULT '',
  category_paths jsonb NOT NULL DEFAULT '[]',
  variant_count integer NOT NULL DEFAULT 0,
  source_write_date text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  visible boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS atelier_catalog.product_collections (
  product_id integer NOT NULL REFERENCES atelier_catalog.products(id),
  collection_key text NOT NULL REFERENCES atelier_catalog.collections(key),
  PRIMARY KEY (product_id, collection_key)
);
CREATE INDEX IF NOT EXISTS catalog_brand ON atelier_catalog.products(brand_slug) WHERE visible;
CREATE INDEX IF NOT EXISTS catalog_legacy ON atelier_catalog.products(legacy_slug) WHERE visible;
CREATE INDEX IF NOT EXISTS catalog_collection ON atelier_catalog.product_collections(collection_key);
