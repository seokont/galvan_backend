export function slugify(value) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function validateBrandNames(names) {
  const identities = new Map();
  for (const name of names) {
    const slug = slugify(name);
    if (!slug || (identities.has(slug) && identities.get(slug) !== name)) {
      throw new Error('Conflicting brand identities; catalog preserved');
    }
    identities.set(slug, name);
  }
}

export function plainText(html) {
  return (html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function mapProduct(raw, categories, attributes) {
  const brand = { slug: slugify(raw.x_brand), name: raw.x_brand };
  const collections = [];
  const categoryPaths = [];
  for (const id of raw.public_categ_ids ?? []) {
    const chain = [];
    const seen = new Set();
    let cat = categories.get(id);
    while (cat && !seen.has(cat.id)) {
      seen.add(cat.id);
      chain.unshift(cat);
      cat = cat.parent_id ? categories.get(cat.parent_id[0]) : null;
    }
    categoryPaths.push(chain.map((c) => c.name).join(' / '));
    const brandIndex = chain.findIndex((c) => slugify(c.name) === brand.slug);
    if (brandIndex >= 0 && brandIndex < chain.length - 1) {
      const leaf = chain.at(-1);
      collections.push({
        key: `${brand.slug}:public:${leaf.id}`,
        name: chain
          .slice(brandIndex + 1)
          .map((c) => c.name)
          .join(' / '),
        brandSlug: brand.slug,
        odooId: leaf.id,
      });
    }
  }
  if (!collections.length && raw.categ_id) {
    const path = raw.categ_id[1].split(' / ');
    const brandIndex = path.findIndex((p) => slugify(p) === brand.slug);
    const remainder = brandIndex >= 0 ? path.slice(brandIndex + 1) : path;
    if (remainder.length)
      collections.push({
        key: `${brand.slug}:internal:${raw.categ_id[0]}`,
        name: remainder.join(' / '),
        brandSlug: brand.slug,
        odooId: raw.categ_id[0],
      });
  }
  return {
    id: raw.id,
    slug: `odoo-${raw.id}`,
    name: raw.name,
    sku: raw.default_code || null,
    brand,
    collections: [...new Map(collections.map((c) => [c.key, c])).values()],
    categoryPaths,
    categoryPath: raw.categ_id?.[1] ?? '',
    attributes,
    silhouette:
      attributes
        .find((a) => a.name.toLowerCase() === 'silhouette')
        ?.values.join(', ') ?? '',
    description: plainText(raw.public_description || raw.website_description),
    variantCount: raw.product_variant_ids?.length ?? 0,
    images: [],
    writeDate: raw.write_date,
    legacySlug:
      brand.slug === 'galvan' && /^g\d{4}(?:\s|$)/i.test(raw.name)
        ? raw.name.split(/\s/)[0].toLowerCase()
        : null,
  };
}
