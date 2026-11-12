# Product name URLs

Public cards use `/products/<model-name>` instead of `/products/odoo-<id>`.
Names are lowercased, spaces/punctuation become hyphens, accents are normalized
and Cyrillic is transliterated. Duplicate names use a brand suffix; a numeric
identifier is added only if needed for uniqueness. Slugs remain within 100
ASCII characters, matching the public API route validation.

`products.slug` is the canonical URL. `product_slug_aliases` permanently reserves
previous URLs for their original product. Odoo-ID URLs and existing legacy
codes resolve the same product; Next's permanentRedirect sends visitors to its
canonical URL (streamed pages may use a meta redirect). Metadata declares the
canonical production URL on store.fashiongroup.online. Hidden models remain
inaccessible through both aliases and canonical paths.

Database triggers update URLs after imported or manually overridden names
change, and after a manual name reset. Existing aliases stay valid. Sync ignores
site-owned slugs when comparing source content. A defensive trigger also repairs
slug-only writes from an older importer during deployment. Model imported_at and
manual edit versions are not changed by URL allocation alone.

Migration 005 backfills existing models. It fails safely if an import currently
holds the catalogue lock; retry after completion. URL allocation uses a fail-fast
transaction lock to avoid deadlocks after a product row has been locked; concurrent
admin renames receive 409 and can be retried without losing draft changes.

Run `npm run build`, `npm test`, `npm run catalog:check-urls` and
`npm run catalog:check-sync`. URL integration checks use a rolled-back transaction
and create no persistent test products. Back up the production database before
applying migration 005; deploy backend/DB before frontend redirects.

## Production verification — 2026-11-12

All 1,273 visible products have unique valid name URLs. Sampled historical Odoo
aliases resolve the same product IDs. A real browser redirected
`/products/odoo-40760` to `/products/0034-scarf`, with correct product title,
loaded image and canonical metadata. The catalog's first 24 cards use name URLs.
All 4,541 referenced image files passed regression checks. Both repositories
are published and the frontend/backend deployments are live.
