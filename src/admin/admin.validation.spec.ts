import { BadRequestException } from '@nestjs/common';
import { validateProductPatch } from './admin.validation.js';
import { hashPassword, verifyPassword, sessionHash } from './password.js';

describe('admin edit validation', () => {
  it('keeps silhouette independent from other attributes', () => {
    expect(() =>
      validateProductPatch({
        version: 0,
        changes: { attributes: [{ name: 'Silhouette', values: ['Princess'] }] },
      }),
    ).toThrow(BadRequestException);
    expect(
      validateProductPatch({ version: 0, changes: { silhouette: 'Princess' } })
        .changes,
    ).toEqual({ silhouette: 'Princess' });
  });
  it('allows explicit empty values without overwriting unrelated fields', () => {
    expect(
      validateProductPatch({
        version: 2,
        changes: { description: '', sku: null, visible: false },
        reset: ['name'],
      }),
    ).toEqual({
      version: 2,
      changes: { description: '', sku: null, visible: false },
      reset: ['name'],
    });
  });
  it('rejects unknown fields, conflicting resets, invalid image names and oversized input', () => {
    for (const body of [
      { version: 0, changes: { id: 1 } },
      { version: -1, changes: {} },
      { version: 0, changes: { name: '' } },
      { version: 0, changes: { name: 'x' }, reset: ['name'] },
      { version: 0, changes: { images: ['../../.env'] } },
      { version: 0, changes: { visible: 'true' } },
      { version: 0, changes: { description: 'x'.repeat(20001) } },
      {
        version: 0,
        changes: {
          attributes: [
            { name: 'Color', values: ['ivory'] },
            { name: 'Color', values: ['nude'] },
          ],
        },
      },
    ])
      expect(() => validateProductPatch(body)).toThrow(BadRequestException);
  });
});

describe('admin credentials', () => {
  it('salts passwords and rejects invalid passwords/hashes', async () => {
    const hash = await hashPassword('a-long-test-password');
    expect(hash).not.toContain('a-long-test-password');
    expect(await verifyPassword('a-long-test-password', hash)).toBe(true);
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
    expect(await verifyPassword('a-long-test-password', 'broken')).toBe(false);
    expect(await hashPassword('a-long-test-password')).not.toBe(hash);
  });
  it('stores only a hash of session tokens', () => {
    expect(sessionHash('token')).toMatch(/^[a-f0-9]{64}$/);
    expect(sessionHash('token')).not.toBe('token');
  });
});
