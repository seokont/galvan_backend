# Atelier backend deployment

Backend: https://backstore.fashiongroup.online

Domain changed on 2026-11-11. The old `store.fashiongroup.online` origin remains
available temporarily so existing Vercel deployments keep working. Update the
Vercel BACKEND_URL and redeploy before retiring or reusing that domain.

Server: 169.58.50.19, application directory `/opt/atelier`.
Frontend is intended for Vercel and was not deployed in this operation.

## Vercel

Set project Root Directory to `frontend` and add the server-only environment
variable in the Production and Preview environments:

```dotenv
BACKEND_URL=https://backstore.fashiongroup.online
```

Redeploy after changing environment variables. For a fixed production frontend
domain, also set `ADMIN_PUBLIC_ORIGIN=https://YOUR-FRONTEND-DOMAIN` in Production
only. Without it, the existing admin proxy validates against the request's own
origin, which also supports Vercel preview domains.

Do not use NEXT_PUBLIC for backend credentials. The existing Next.js catalog
and admin proxy routes make server-side requests to NestJS, so browser CORS
configuration is unnecessary. Admin login UI stays at `/admin/login` on the
frontend; `/admin` on this backend domain is not an HTML admin interface.
The existing administrator account/password was preserved during migration.

Vercel integration limitation: the current admin photo upload goes through a
Next.js Function, whose request limit is 4.5 MB, although NestJS accepts 8 MiB.
Use images below 4 MB until a direct authenticated upload flow or client-side
compression is implemented. Larger uploads fail at Vercel before reaching this
backend. See https://vercel.com/docs/functions/limitations#request-body-size.

## Server layout

Repository: https://github.com/seokont/galvan_backend.git, checked out as
`/opt/atelier/backend`. Deployment templates live in this repository's `deploy/`
folder. For the documented server layout copy `deploy/compose.yaml` into
`/opt/atelier/compose.yaml` and run Compose from `/opt/atelier`; the `./backend`
build context and `./storage/catalog` mount are relative to that directory.
Do not run this Compose file with its `deploy/` folder as the project directory.

- `compose.yaml`: dedicated `atelier` project, Node 24 backend and PostgreSQL 18.
- `.backend.env`, `.postgres.env`: root-only secrets, never commit or print.
- `storage/catalog`: permanent catalog files, UID/GID 1000 for backend writes.
- Docker volume `atelier_postgres-data`: PostgreSQL data; no published DB port.
- Backend listens on host `127.0.0.1:3001` behind Nginx.
- `/etc/nginx/sites-available/backstore.fashiongroup.online`: dedicated domain config.
- Certbot certificate renewal is scheduled automatically.
- `backups/initial-catalog.dump`: initial schema/data snapshot, no active sessions.

All unrelated containers and Nginx sites were preserved. Odoo was not modified,
and no automatic import/sync schedule was enabled.

## Operations

From `/opt/atelier`:

```sh
docker compose ps
docker compose logs --tail=100 backend
docker compose exec -T -e DEPLOYMENT_URL=https://backstore.fashiongroup.online backend node scripts/check-deployment.mjs
```

For subsequent releases upload backend source (exclude `.env`, `storage`,
`node_modules`, and `dist`), then rebuild and recreate only backend:

```sh
docker compose build backend
docker compose up -d backend
```

Apply new migrations before running releases that require them. Current
deployment restored both existing migrations. CLI migration/import scripts
expect a `.env` file, while containers receive runtime variables through
Compose; do not copy secrets into an image to satisfy this requirement.

Before migrations, make a protected backup:

```sh
umask 077
docker compose exec -T postgres pg_dump -U atelier -d atelier -Fc > backups/catalog-$(date +%Y%m%d-%H%M%S).dump
```

Also back up `storage/catalog`. Scheduled/off-server backups have not been
configured. Do not run `docker compose down -v`: it deletes the database volume.

## Verification on 2026-11-07

Local backend build passed, 17/17 tests passed. Production Docker build passed;
production dependency audit reported zero vulnerabilities. Both containers are
healthy. HTTPS API/media checks passed through Cloudflare, 1,273 products,
9 brands, 87 collections, 4,541 referenced image files accessible, existing
admin account retained and session count zero. Unauthenticated admin calls
return 401. Nginx configuration passed and Certbot timer is active.
Independent deployment review found no backend blocker; the Vercel upload-size
limitation above is deferred to frontend deployment work.
