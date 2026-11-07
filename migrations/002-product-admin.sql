CREATE TABLE atelier_catalog.admin_accounts (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email=lower(email)), password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE atelier_catalog.admin_sessions (
  token_hash text PRIMARY KEY, admin_id integer NOT NULL REFERENCES atelier_catalog.admin_accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_session_expiry ON atelier_catalog.admin_sessions(expires_at);
CREATE TABLE atelier_catalog.product_overrides (
  product_id integer PRIMARY KEY REFERENCES atelier_catalog.products(id), changes jsonb NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(), updated_by integer REFERENCES atelier_catalog.admin_accounts(id)
);
CREATE TABLE atelier_catalog.admin_media (
  filename text PRIMARY KEY, uploaded_by integer NOT NULL REFERENCES atelier_catalog.admin_accounts(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE VIEW atelier_catalog.effective_products AS
SELECT p.id,p.slug,p.legacy_slug,
  COALESCE(o.changes->>'name',p.name) AS name,
  CASE WHEN o.changes ? 'sku' THEN o.changes->>'sku' ELSE p.sku END AS sku,
  COALESCE(o.changes->>'brandSlug',p.brand_slug) AS brand_slug,
  COALESCE(o.changes->>'silhouette',p.silhouette) AS silhouette,
  COALESCE(o.changes->>'description',p.description) AS description,
  COALESCE(o.changes->'attributes',p.attributes) AS attributes,
  COALESCE(o.changes->'images',p.images) AS images,
  p.category_path,p.category_paths,p.variant_count,p.source_write_date,p.imported_at,
  COALESCE((o.changes->>'visible')::boolean,p.visible) AS visible,
  COALESCE(o.version,0) AS edit_version,COALESCE(o.changes,'{}'::jsonb) AS overrides
FROM atelier_catalog.products p LEFT JOIN atelier_catalog.product_overrides o ON o.product_id=p.id;
CREATE VIEW atelier_catalog.effective_product_collections AS
SELECT p.id AS product_id,c.key AS collection_key
FROM atelier_catalog.effective_products p
JOIN atelier_catalog.product_overrides o ON o.product_id=p.id AND o.changes ? 'collectionKeys'
CROSS JOIN LATERAL jsonb_array_elements_text(o.changes->'collectionKeys') k(value)
JOIN atelier_catalog.collections c ON c.key=k.value AND c.brand_slug=p.brand_slug
UNION ALL
SELECT pc.product_id,pc.collection_key FROM atelier_catalog.product_collections pc
JOIN atelier_catalog.effective_products p ON p.id=pc.product_id
JOIN atelier_catalog.collections c ON c.key=pc.collection_key AND c.brand_slug=p.brand_slug
WHERE NOT (p.overrides ? 'collectionKeys');
