# Contact enquiries

The contact form POSTs to the Next.js `/api/enquiries` proxy, then NestJS
`POST /enquiries`. PostgreSQL stores the enquiry in `atelier_catalog.enquiries`.
No Odoo writes or automatic email delivery occur.

Website administrators use `/admin/enquiries` on the frontend. Existing login
is required. Search covers name, email, phone and message. Statuses are `new`,
`in_progress`, `closed`, `spam`; notes are internal. Optimistic versions reject
stale updates with 409 rather than overwrite another administrator's changes.

Public creation returns only `{ok:true}`. UUID retries are idempotent, mismatched
payloads return 409. Fields are bounded and validated, extra internal fields are
rejected, and the honeypot ignores obvious bots. PostgreSQL enforces three new
submissions per email per ten minutes. Nest's 300/minute proxy-peer ceiling is
global safety protection, not a per-visitor limit. On Vercel, a bounded per-instance
IP-hash limiter adds eight attempts per ten minutes; it is best-effort across
serverless instances. Raw visitor IPs are not logged or stored.
Vercel overwrites visitor IP headers at its managed boundary:
https://vercel.com/docs/headers/request-headers#x-forwarded-for.

Run `npm run db:migrate`, `npm run build`, `npm test`, and `npm run crm:check`.
The integration check creates clearly marked synthetic rows and a temporary
admin session, checks persistence/auth/retries/conflicts/limits, then deletes only
its own test data. Apply migration 003 before deploying the new frontend.

Data is retained until an operator's retention policy removes it; there is no
delete UI. Access is restricted to administrators. Include enquiries in database
backups; don't log messages, email addresses, authentication tokens or passwords.
