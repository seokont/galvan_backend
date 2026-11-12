import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Pool } from 'pg';
import {
  ENQUIRY_STATUSES,
  parseEnquiry,
  parseEnquiryPatch,
} from './enquiries.validation.js';
const fields =
  'id, name, email, phone, subject, message, status, notes, version, created_at AS "createdAt", updated_at AS "updatedAt"';
@Injectable()
export class EnquiriesService {
  constructor(@Inject(Pool) private readonly db: Pool) {}
  async create(body: unknown) {
    const input = parseEnquiry(body);
    if (input.website) return { ok: true };
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'enquiry-submission:' + input.submissionId,
      ]);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'enquiry:' + input.email,
      ]);
      const existing = await client.query(
        'SELECT name,email,phone,subject,message FROM atelier_catalog.enquiries WHERE submission_id=$1',
        [input.submissionId],
      );
      if (
        existing.rowCount &&
        ['name', 'email', 'phone', 'subject', 'message'].some(
          (key) => existing.rows[0][key] !== input[key as keyof typeof input],
        )
      )
        throw new ConflictException(
          'This submission was already saved with different details',
        );
      if (!existing.rowCount) {
        const count = await client.query(
          "SELECT count(*)::int AS n FROM atelier_catalog.enquiries WHERE email=$1 AND created_at>now()-interval '10 minutes'",
          [input.email],
        );
        if (count.rows[0].n >= 3)
          throw new HttpException(
            'Please wait before sending another enquiry',
            429,
          );
        await client.query(
          'INSERT INTO atelier_catalog.enquiries(submission_id,name,email,phone,subject,message) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(submission_id) DO NOTHING',
          [
            input.submissionId,
            input.name,
            input.email,
            input.phone,
            input.subject,
            input.message,
          ],
        );
      }
      await client.query('COMMIT');
      return { ok: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async list(query: Record<string, unknown>) {
    if (Object.keys(query).some((k) => !['q', 'status', 'page'].includes(k)))
      throw new BadRequestException('Invalid filter');
    const q = query.q === undefined ? '' : query.q;
    const status = query.status === undefined ? '' : query.status;
    const page = query.page === undefined ? '1' : query.page;
    if (
      typeof q !== 'string' ||
      q.length > 100 ||
      typeof status !== 'string' ||
      (status &&
        !ENQUIRY_STATUSES.includes(
          status as (typeof ENQUIRY_STATUSES)[number],
        )) ||
      typeof page !== 'string' ||
      !/^\d{1,6}$/.test(page) ||
      Number(page) < 1
    )
      throw new BadRequestException('Invalid filter');
    const params = [status, q];
    const where =
      "WHERE ($1='' OR status=$1) AND ($2='' OR name ILIKE '%'||$2||'%' OR email ILIKE '%'||$2||'%' OR phone ILIKE '%'||$2||'%' OR message ILIKE '%'||$2||'%')";
    const total = (
      await this.db.query(
        'SELECT count(*)::int AS n FROM atelier_catalog.enquiries ' + where,
        params,
      )
    ).rows[0].n;
    const items = (
      await this.db.query(
        'SELECT ' +
          fields +
          ' FROM atelier_catalog.enquiries ' +
          where +
          ' ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET $3',
        [...params, (Number(page) - 1) * 20],
      )
    ).rows;
    return { items, total, page: Number(page), pages: Math.ceil(total / 20) };
  }
  async update(id: number, body: unknown) {
    const patch = parseEnquiryPatch(body);
    const result = await this.db.query(
      'UPDATE atelier_catalog.enquiries SET status=$1, notes=$2, version=version+1, updated_at=now() WHERE id=$3 AND version=$4 RETURNING ' +
        fields,
      [patch.status, patch.notes, id, patch.version],
    );
    if (!result.rowCount) {
      if (
        !(
          await this.db.query(
            'SELECT 1 FROM atelier_catalog.enquiries WHERE id=$1',
            [id],
          )
        ).rowCount
      )
        throw new NotFoundException('Enquiry not found');
      throw new ConflictException(
        'Заявку вже змінено. Оновіть список і повторіть зміни.',
      );
    }
    return result.rows[0];
  }
}
