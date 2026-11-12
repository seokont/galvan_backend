import { BadRequestException } from '@nestjs/common';
export type ProductChanges = {
  name?: string;
  sku?: string | null;
  description?: string;
  brandSlug?: string;
  silhouette?: string;
  attributes?: { name: string; values: string[] }[];
  collectionKeys?: string[];
  images?: string[];
  visible?: boolean;
};
export const EDITABLE_FIELDS = [
  'name',
  'sku',
  'description',
  'brandSlug',
  'silhouette',
  'attributes',
  'collectionKeys',
  'images',
  'visible',
] as const;
export const IMAGE_NAME = /^[a-f0-9]{64}\.(jpg|png|webp|gif)$/;
function invalid(message: string): never {
  throw new BadRequestException(message);
}
function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    invalid('Expected an object');
  return input as Record<string, unknown>;
}
function text(value: unknown, max: number, empty = true): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    value.includes('\0') ||
    (!empty && !value.trim())
  )
    invalid('Invalid text value');
  return value.trim();
}
function strings(
  value: unknown,
  maxCount: number,
  maxLength: number,
): string[] {
  if (!Array.isArray(value) || value.length > maxCount)
    invalid('Too many values');
  const result = value.map((v) => text(v, maxLength, false));
  if (new Set(result).size !== result.length) invalid('Values must be unique');
  return result;
}
export function validateProductPatch(input: unknown): {
  version: number;
  changes: ProductChanges;
  reset: string[];
} {
  const body = record(input);
  if (
    Object.keys(body).some((k) => !['version', 'changes', 'reset'].includes(k))
  )
    invalid('Unknown request field');
  if (!Number.isSafeInteger(body.version) || Number(body.version) < 0)
    invalid('Invalid product version');
  const raw = record(body.changes ?? {});
  const changes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!(EDITABLE_FIELDS as readonly string[]).includes(key))
      invalid('Field cannot be edited: ' + key);
    switch (key) {
      case 'name':
        changes.name = text(value, 250, false);
        break;
      case 'sku':
        changes.sku = value === null ? null : text(value, 120);
        break;
      case 'description':
        changes.description = text(value, 20000);
        break;
      case 'brandSlug': {
        const slug = text(value, 80, false);
        if (!/^[a-z0-9-]+$/.test(slug)) invalid('Invalid brand');
        changes.brandSlug = slug;
        break;
      }
      case 'silhouette':
        changes.silhouette = text(value, 100);
        break;
      case 'visible':
        if (typeof value !== 'boolean') invalid('Visibility must be a boolean');
        changes.visible = value;
        break;
      case 'images': {
        const names = strings(value, 30, 80);
        if (names.some((n) => !IMAGE_NAME.test(n))) invalid('Invalid photo');
        changes.images = names;
        break;
      }
      case 'collectionKeys':
        changes.collectionKeys = strings(value, 20, 160);
        break;
      case 'attributes': {
        if (!Array.isArray(value) || value.length > 60)
          invalid('Too many attributes');
        const names = new Set<string>();
        changes.attributes = value.map((item) => {
          const attr = record(item);
          if (Object.keys(attr).some((k) => !['name', 'values'].includes(k)))
            invalid('Unknown attribute field');
          const name = text(attr.name, 120, false);
          if (name.toLowerCase() === 'silhouette')
            invalid('Edit the silhouette in its separate field above');
          if (names.has(name.toLowerCase()))
            invalid('Attribute names must be unique');
          names.add(name.toLowerCase());
          return { name, values: strings(attr.values, 100, 250) };
        });
        break;
      }
    }
  }
  const reset =
    body.reset === undefined
      ? []
      : strings(body.reset, EDITABLE_FIELDS.length, 30);
  if (
    reset.some(
      (k) =>
        !(EDITABLE_FIELDS as readonly string[]).includes(k) || k in changes,
    )
  )
    invalid('Invalid field reset');
  return { version: Number(body.version), changes, reset };
}
