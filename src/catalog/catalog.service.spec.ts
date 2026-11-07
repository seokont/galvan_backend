import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CatalogService, parseCatalogQuery } from './catalog.service.js';

describe('catalog API', () => {
  it('shows the effective silhouette even when source attributes contain an older value', async () => {
    const row = {
      id: 1,
      slug: 'odoo-1',
      name: 'Test',
      sku: null,
      brand_slug: 'galvan',
      brand_name: 'Galvan',
      silhouette: 'Princess',
      description: '',
      attributes: [
        { name: 'Silhouette', values: ['A-Line'] },
        { name: 'Color', values: ['ivory'] },
      ],
      images: [],
      variant_count: 1,
      collections: [],
    };
    const service = new CatalogService({
      query: vi.fn().mockResolvedValue({ rows: [row] }),
    } as never);
    const product = await service.detail('odoo-1');
    expect(
      product.attributes?.find((a) => a.name === 'Silhouette')?.values,
    ).toEqual(['Princess']);
    expect(product.attributes?.find((a) => a.name === 'Color')?.values).toEqual(
      ['ivory'],
    );
  });
  it('rejects invalid pagination and repeated query values', () => {
    for (const query of [
      { page: '0' },
      { page: '1.5' },
      { limit: '1000' },
      { brand: ['a', 'b'] },
      { q: 'x'.repeat(101) },
    ]) {
      expect(() => parseCatalogQuery(query)).toThrow(BadRequestException);
    }
    expect(parseCatalogQuery({})).toMatchObject({ page: 1, limit: 24 });
  });
  it('binds filters as SQL parameters and scopes collection to the selected brand', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValue({ rows: [] }),
    };
    const service = new CatalogService(pool as never);
    await service.list({
      brand: 'galvan',
      collection: "x' OR 1=1 --",
      q: '100%',
    });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).not.toContain("x' OR");
    expect(sql).toContain('p.brand_slug=');
    expect(params).toContain("x' OR 1=1 --");
    expect(params).toContain('%100\\%%');
  });
  it('returns 404 for missing and hidden products', async () => {
    const service = new CatalogService({
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as never);
    await expect(service.detail('odoo-999')).rejects.toThrow(NotFoundException);
  });
});
