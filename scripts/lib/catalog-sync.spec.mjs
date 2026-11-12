import { describe, it, expect } from 'vitest';
import { catalogSnapshot, changedProduct } from './catalog-sync.mjs';
const product = {
  id: 1,
  slug: 'odoo-1',
  legacySlug: null,
  name: 'Dress',
  sku: null,
  brand: { slug: 'a', name: 'A' },
  collections: [{ key: 'a:1', name: '2026', brandSlug: 'a', odooId: 1 }],
  categoryPaths: ['A / 2026'],
  categoryPath: 'A / 2026',
  attributes: [{ name: 'Size', values: ['38'] }],
  silhouette: '',
  description: 'Satin',
  variantCount: 1,
  images: ['abc.jpg'],
  writeDate: '2026-01-01',
};
describe('incremental source content comparison', () => {
  it('ignores source timestamps and treats equivalent object key order equally', () => {
    expect(
      changedProduct(product, { ...product, writeDate: '2026-02-02' }),
    ).toBe(false);
    expect(catalogSnapshot(product)).not.toContain('2026-01-01');
  });
  it('detects photo order, model details, attributes and collection changes', () => {
    for (const patch of [
      { name: 'New' },
      { images: ['other.jpg'] },
      { attributes: [] },
      { collections: [] },
      { brand: { slug: 'a', name: 'Renamed' } },
    ])
      expect(changedProduct(product, { ...product, ...patch })).toBe(true);
  });
  it('compares collections independent of source ordering', () => {
    const two = { key: 'a:2', name: 'Other', brandSlug: 'a', odooId: 2 };
    expect(
      changedProduct(
        { ...product, collections: [...product.collections, two] },
        { ...product, collections: [two, ...product.collections] },
      ),
    ).toBe(false);
  });
});
