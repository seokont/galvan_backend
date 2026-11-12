-- Do not race a running importer; fail without waiting in reversed lock order.
DO $$ BEGIN
  IF NOT pg_try_advisory_xact_lock(74182016) THEN
    RAISE EXCEPTION 'Catalog import is running; retry migration after it completes' USING ERRCODE='55P03';
  END IF;
END $$;

CREATE TABLE atelier_catalog.product_slug_aliases (
  slug text PRIMARY KEY,
  product_id integer NOT NULL REFERENCES atelier_catalog.products(id) ON DELETE CASCADE
);
CREATE INDEX product_slug_alias_owner ON atelier_catalog.product_slug_aliases(product_id);
INSERT INTO atelier_catalog.product_slug_aliases(slug,product_id) SELECT slug,id FROM atelier_catalog.products;
INSERT INTO atelier_catalog.product_slug_aliases(slug,product_id)
SELECT DISTINCT ON (legacy_slug) legacy_slug,id FROM atelier_catalog.products WHERE legacy_slug IS NOT NULL ORDER BY legacy_slug,id
ON CONFLICT DO NOTHING;

CREATE FUNCTION atelier_catalog.name_slug(input text) RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE value text; part record;
BEGIN
  value:=lower(normalize(input,NFKD));
  value:=regexp_replace(value,U&'[\0300-\036f]','','g');
  FOR part IN SELECT key,val FROM jsonb_each_text('{"а":"a","б":"b","в":"v","г":"h","ґ":"g","д":"d","е":"e","є":"ie","ж":"zh","з":"z","и":"y","і":"i","ї":"i","й":"i","к":"k","л":"l","м":"m","н":"n","о":"o","п":"p","р":"r","с":"s","т":"t","у":"u","ф":"f","х":"kh","ц":"ts","ч":"ch","ш":"sh","щ":"shch","ь":"","ъ":"","ы":"y","э":"e","ю":"iu","я":"ia"}'::jsonb) AS t(key,val)
  LOOP value:=replace(value,part.key,part.val); END LOOP;
  RETURN trim(both '-' from left(trim(both '-' from regexp_replace(value,'[^a-z0-9]+','-','g')),60));
END $$;

CREATE FUNCTION atelier_catalog.refresh_product_slug(product integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE item record; base text; brand text; candidate text; owner integer; attempt integer;
BEGIN
  SELECT p.slug,p.legacy_slug,COALESCE(o.changes->>'name',p.name) AS name,COALESCE(o.changes->>'brandSlug',p.brand_slug) AS brand_slug INTO item
  FROM atelier_catalog.products p LEFT JOIN atelier_catalog.product_overrides o ON o.product_id=p.id WHERE p.id=product;
  IF NOT FOUND THEN RETURN; END IF;
  -- Never wait for a URL allocator after the caller already locked a product row.
  IF NOT pg_try_advisory_xact_lock(74182018) THEN
    RAISE EXCEPTION 'Product URLs are being updated; retry' USING ERRCODE='55P03';
  END IF;
  INSERT INTO atelier_catalog.product_slug_aliases(slug,product_id)
    SELECT v.slug,product FROM (VALUES(item.slug),('odoo-'||product::text),(item.legacy_slug)) v(slug) WHERE v.slug IS NOT NULL AND v.slug<>'' ON CONFLICT DO NOTHING;
  base:=atelier_catalog.name_slug(item.name);
  IF base='' THEN base:='model-'||product::text; END IF;
  IF base~'^odoo-[0-9]+$' THEN base:='model-'||base; END IF;
  brand:=left(atelier_catalog.name_slug(item.brand_slug),16);
  FOR attempt IN 0..9999 LOOP
    candidate:=CASE WHEN attempt=0 THEN base WHEN attempt=1 THEN base||'-'||brand ELSE base||'-'||brand||'-'||product::text||CASE WHEN attempt=2 THEN '' ELSE '-'||(attempt-1)::text END END;
    INSERT INTO atelier_catalog.product_slug_aliases(slug,product_id) VALUES(candidate,product) ON CONFLICT DO NOTHING;
    SELECT product_id INTO owner FROM atelier_catalog.product_slug_aliases WHERE slug=candidate;
    IF owner=product THEN
      UPDATE atelier_catalog.products SET slug=candidate WHERE id=product AND slug IS DISTINCT FROM candidate;
      RETURN;
    END IF;
  END LOOP;
  RAISE EXCEPTION 'Unable to allocate unique product URL';
END $$;

CREATE FUNCTION atelier_catalog.product_slug_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.slug IS NOT DISTINCT FROM NEW.slug AND OLD.name IS NOT DISTINCT FROM NEW.name AND OLD.brand_slug IS NOT DISTINCT FROM NEW.brand_slug AND OLD.legacy_slug IS NOT DISTINCT FROM NEW.legacy_slug THEN RETURN NULL; END IF;
  PERFORM atelier_catalog.refresh_product_slug(NEW.id); RETURN NULL;
END $$;
CREATE TRIGGER product_name_url AFTER INSERT OR UPDATE OF slug,name,brand_slug,legacy_slug ON atelier_catalog.products FOR EACH ROW EXECUTE FUNCTION atelier_catalog.product_slug_trigger();

CREATE FUNCTION atelier_catalog.override_slug_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.changes ?| ARRAY['name','brandSlug'] THEN PERFORM atelier_catalog.refresh_product_slug(OLD.product_id); END IF;
  ELSIF TG_OP='INSERT' THEN
    IF NEW.changes ?| ARRAY['name','brandSlug'] THEN PERFORM atelier_catalog.refresh_product_slug(NEW.product_id); END IF;
  ELSIF OLD.changes->'name' IS DISTINCT FROM NEW.changes->'name' OR OLD.changes->'brandSlug' IS DISTINCT FROM NEW.changes->'brandSlug' THEN
    PERFORM atelier_catalog.refresh_product_slug(NEW.product_id);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER override_name_url AFTER INSERT OR UPDATE OR DELETE ON atelier_catalog.product_overrides FOR EACH ROW EXECUTE FUNCTION atelier_catalog.override_slug_trigger();

DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT id FROM atelier_catalog.products ORDER BY id LOOP
    PERFORM atelier_catalog.refresh_product_slug(item.id);
  END LOOP;
END $$;
