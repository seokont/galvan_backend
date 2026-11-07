import { describe, it, expect, vi } from 'vitest';
import { OdooReader } from './odoo-readonly.mjs';
import { mapProduct, validateBrandNames } from './catalog-mapping.mjs';

describe('read-only Odoo integration', () => {
  it('blocks writes and unknown models before any network request', async () => {
    const fetcher = vi.fn();
    const reader = new OdooReader(
      { url: 'https://example.com', database: 'db', key: 'secret' },
      fetcher,
    );
    for (const method of [
      'create',
      'write',
      'unlink',
      'action_publish',
      'read_group',
    ]) {
      await expect(reader.call('product.template', method, {})).rejects.toThrow(
        'Read-only',
      );
    }
    await expect(reader.call('res.users', 'search_read', {})).rejects.toThrow(
      'Read-only',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not expose secrets in remote errors', async () => {
    const reader = new OdooReader(
      { url: 'https://example.com', database: 'db', key: 'secret' },
      vi.fn().mockResolvedValue({ ok: false, status: 403 }),
    );
    await expect(
      reader.call('product.template', 'search_read', {}),
    ).rejects.toThrow('Odoo read failed (403)');
  });
});

describe('catalog mapping', () => {
  it('rejects empty and colliding brand identities before publishing', () => {
    expect(() => validateBrandNames(['A & B', 'A B'])).toThrow(
      'Conflicting brand',
    );
    expect(() => validateBrandNames(['!!!'])).toThrow('Conflicting brand');
    expect(() =>
      validateBrandNames(['Galvan', 'Galvan', 'Serena']),
    ).not.toThrow();
  });
  it('scopes collection identity to brand and uses website collections', () => {
    const categories = new Map([
      [89, { id: 89, name: 'Daniela di Marino', parent_id: false }],
      [
        1405,
        { id: 1405, name: 'Ultimate', parent_id: [89, 'Daniela di Marino'] },
      ],
    ]);
    const p = mapProduct(
      {
        id: 39011,
        name: '7400',
        x_brand: 'Daniela Di Marino',
        categ_id: [1854, 'Daniela Di Marino / Ultimate / 2025'],
        public_categ_ids: [1405],
        product_variant_ids: [1, 2],
      },
      categories,
      [],
    );
    expect(p.slug).toBe('odoo-39011');
    expect(p.brand.slug).toBe('daniela-di-marino');
    expect(p.collections.map((c) => c.name)).toEqual(['Ultimate']);
    expect(p.collections[0].key).toBe('daniela-di-marino:public:1405');
    expect(p.variantCount).toBe(2);
  });
  it('preserves attributes and falls back to internal categories', () => {
    const p = mapProduct(
      {
        id: 10,
        name: 'Test',
        x_brand: 'Galvan',
        categ_id: [4, 'Galvan / New Collection'],
        public_categ_ids: [],
      },
      new Map(),
      [{ name: 'Size', values: ['34eu 38it 2us', 'Ind'] }],
    );
    expect(p.collections[0].name).toBe('New Collection');
    expect(p.attributes[0].values).toEqual(['34eu 38it 2us', 'Ind']);
    expect(p.images).toEqual([]);
  });
});
