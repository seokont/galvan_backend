CREATE TABLE atelier_catalog.catalog_sync_runs (
  id uuid PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('running','succeeded','failed')),
  phase text NOT NULL DEFAULT 'starting',
  stats jsonb NOT NULL DEFAULT '{}',
  result jsonb,
  current_model text NOT NULL DEFAULT '',
  error text,
  started_by integer REFERENCES atelier_catalog.admin_accounts(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE UNIQUE INDEX catalog_sync_single_running ON atelier_catalog.catalog_sync_runs ((status)) WHERE status='running';
CREATE INDEX catalog_sync_latest ON atelier_catalog.catalog_sync_runs (started_at DESC);
