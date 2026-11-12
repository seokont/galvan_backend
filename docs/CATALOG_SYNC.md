# Admin catalogue synchronization

Open frontend `/admin/settings` and click **Синхронізувати товари з Odoo**.
Existing administrator login is required. The browser starts a background
server job and polls its state every two seconds. It can be closed while the
job continues. The settings page displays source-read/metadata/photo/comparison/
publication phases, counts and links to the first 50 new or updated models.

Public Odoo models and methods remain strictly allowlisted by `OdooReader`.
All Odoo calls are read-only. Credentials stay in the backend environment.
The browser supplies no source URLs, command arguments or secrets.

The importer compares normalized source content: model identity, name, SKU,
description, attributes, silhouette, variant count, brand, collections,
category paths and ordered photos. A source `write_date` change alone is not
a catalogue change. Identical models keep their imported_at, source timestamp
and relationship rows untouched. Existing media are hash-verified and reused;
incomplete photos are recovered through temporary writes and atomic rename.

Only new and changed source models are published. Manual changes in
`product_overrides` remain effective. Products absent from the eligible Odoo
result are retained; this action does not delete or unpublish existing models.
An empty source response fails safely. New source files may remain cached after
a failed import; existing catalogue publication is transactional.

`atelier_catalog.catalog_sync_runs` persists progress, summary and sanitized
errors. A partial unique index permits only one running admin job. The shared
PostgreSQL advisory lock also excludes concurrent CLI imports. A worker sends
heartbeats every 15 seconds; a job without a heartbeat for two minutes is
marked interrupted when settings is read or a new sync is requested. After a
server restart, retry the interrupted job; don't manually edit running rows.
Job success and catalogue updates commit in the same database transaction.

Backend endpoints: authenticated `GET /admin/catalog-sync` and
`POST /admin/catalog-sync`; Next proxy uses `/api/admin/catalog-sync` and the
existing same-origin checks/admin cookie. No frontend request stays open for
the duration of a sync, avoiding Vercel Function timeouts.

Checks:

```sh
npm run build
npm test
npm run catalog:check-sync
npm run catalog:check-sync-api
```

Integration tests use a fake Odoo reader and only uniquely marked local QA
records; they do not send any request to Odoo. CLI import uses the same engine:
`npm run catalog:import`. Container runtime variables are supported without a
`.env` file. Deploy migration 004 before the new backend/frontend.

For failed jobs, use `docker compose logs --tail=100 backend` from `/opt/atelier`.
Logs contain a job ID, phase and a safe error code, never source credentials.
