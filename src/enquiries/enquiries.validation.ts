import { BadRequestException } from '@nestjs/common';
export const ENQUIRY_STATUSES = [
  'new',
  'in_progress',
  'closed',
  'spam',
] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];
function record(value: unknown, allowed: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !allowed.includes(k))
  )
    throw new BadRequestException('Invalid enquiry fields');
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, required = true) {
  if (value === undefined && !required) return '';
  if (
    typeof value !== 'string' ||
    value.length > max ||
    value.includes('\0') ||
    (required && !value.trim())
  )
    throw new BadRequestException('Invalid enquiry fields');
  return value.trim();
}
export function parseEnquiry(value: unknown) {
  const v = record(value, [
    'submissionId',
    'name',
    'email',
    'phone',
    'subject',
    'message',
    'website',
  ]);
  const submissionId = text(v.submissionId, 36);
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      submissionId,
    )
  )
    throw new BadRequestException('Invalid submission identifier');
  const email = text(v.email, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new BadRequestException('Invalid email address');
  return {
    submissionId,
    name: text(v.name, 120),
    email,
    phone: text(v.phone, 50, false),
    subject: text(v.subject, 120),
    message: text(v.message, 4000),
    website: text(v.website, 200, false),
  };
}
export function parseEnquiryPatch(value: unknown) {
  const v = record(value, ['status', 'notes', 'version']);
  if (
    !ENQUIRY_STATUSES.includes(v.status as EnquiryStatus) ||
    !Number.isSafeInteger(v.version) ||
    Number(v.version) < 1
  )
    throw new BadRequestException('Invalid status or version');
  return {
    status: v.status as EnquiryStatus,
    notes: text(v.notes, 4000, false),
    version: Number(v.version),
  };
}
