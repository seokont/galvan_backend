import { describe, it, expect } from 'vitest';
import { parseEnquiry, parseEnquiryPatch } from './enquiries.validation.js';
const input = {
  submissionId: '9be1e8af-7eb6-47e3-9d31-099d687dfe3f',
  name: ' Anna ',
  email: 'ANNA@example.com',
  phone: '+380 50 123 4567',
  subject: 'A dress',
  message: 'Please contact me.',
};
describe('contact enquiry validation', () => {
  it('normalizes contact fields and preserves the message', () => {
    expect(parseEnquiry(input)).toMatchObject({
      name: 'Anna',
      email: 'anna@example.com',
      message: input.message,
    });
  });
  it('rejects invalid addresses, blank names, huge messages and invalid UUIDs', () => {
    for (const patch of [
      { email: 'x\n@example.com' },
      { name: ' ' },
      { message: 'x'.repeat(4001) },
      { submissionId: '1' },
    ])
      expect(() => parseEnquiry({ ...input, ...patch })).toThrow();
  });
  it('rejects client supplied status or internal notes', () => {
    expect(() => parseEnquiry({ ...input, status: 'closed' })).toThrow();
    expect(() => parseEnquiry({ ...input, notes: 'fake' })).toThrow();
  });
  it('allows only known statuses and a valid edit version', () => {
    expect(
      parseEnquiryPatch({ status: 'in_progress', notes: 'Called', version: 1 }),
    ).toEqual({ status: 'in_progress', notes: 'Called', version: 1 });
    for (const patch of [
      { status: 'other', version: 1, notes: '' },
      { status: 'new', notes: '', version: 0 },
      { status: 'new', version: 1, notes: 'x'.repeat(4001) },
    ])
      expect(() => parseEnquiryPatch(patch)).toThrow();
  });
});
