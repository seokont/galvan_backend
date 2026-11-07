import { readdir, readFile } from 'node:fs/promises';
export async function migrate(db) {
  await db.query('SELECT pg_advisory_lock(74182017)');
  try {
    await db.query('BEGIN');
    await db.query('CREATE SCHEMA IF NOT EXISTS atelier_catalog');
    await db.query(
      'CREATE TABLE IF NOT EXISTS atelier_catalog.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const folder = new URL('../../migrations/', import.meta.url);
    for (const name of (await readdir(folder))
      .filter((n) => /^\d+.*\.sql$/.test(n))
      .sort()) {
      if (
        (
          await db.query(
            'SELECT 1 FROM atelier_catalog.schema_migrations WHERE name=$1',
            [name],
          )
        ).rows.length
      )
        continue;
      await db.query(await readFile(new URL(name, folder), 'utf8'));
      await db.query(
        'INSERT INTO atelier_catalog.schema_migrations(name) VALUES($1)',
        [name],
      );
    }
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    await db.query('SELECT pg_advisory_unlock(74182017)');
  }
}
