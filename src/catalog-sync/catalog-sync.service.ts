import {
  BadRequestException,
  Inject,
  Injectable,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
const fields =
  'id,status,phase,stats,result,current_model AS "currentModel",error,started_at AS "startedAt",finished_at AS "finishedAt"';
@Injectable()
export class CatalogSyncService implements OnModuleDestroy {
  private child: ChildProcess | null = null;
  constructor(@Inject(Pool) private readonly db: Pool) {}
  private enabled() {
    return Boolean(
      process.env.ODOO_URL &&
      process.env.ODOO_DATABASE &&
      process.env.ODOO_API_KEY,
    );
  }
  private async recover() {
    await this.db.query(
      "UPDATE atelier_catalog.catalog_sync_runs SET status='failed',phase='failed',error='Синхронізацію перервано перезапуском або втратою зв’язку. Запустіть її знову.',finished_at=now() WHERE status='running' AND heartbeat_at<now()-interval '2 minutes'",
    );
  }
  async latest() {
    await this.recover();
    return {
      enabled: this.enabled(),
      job:
        (
          await this.db.query(
            'SELECT ' +
              fields +
              ' FROM atelier_catalog.catalog_sync_runs ORDER BY started_at DESC,id DESC LIMIT 1',
          )
        ).rows[0] ?? null,
    };
  }
  async start(adminId: number) {
    if (!this.enabled())
      throw new BadRequestException(
        'На сервері не налаштовано доступ до Odoo.',
      );
    await this.recover();
    const id = randomUUID();
    const inserted = await this.db.query(
      "INSERT INTO atelier_catalog.catalog_sync_runs(id,status,started_by) VALUES($1,'running',$2) ON CONFLICT DO NOTHING RETURNING id",
      [id, adminId],
    );
    if (!inserted.rowCount) return this.latest();
    try {
      const child = spawn(
        process.execPath,
        ['scripts/catalog-sync-worker.mjs', id],
        {
          cwd: process.cwd(),
          env: process.env,
          stdio: ['ignore', 'ignore', 'inherit'],
          windowsHide: true,
        },
      );
      this.child = child;
      const failed = () => {
        void this.db
          .query(
            "UPDATE atelier_catalog.catalog_sync_runs SET status='failed',phase='failed',error='Фоновий процес синхронізації зупинився. Повторіть спробу.',finished_at=now() WHERE id=$1 AND status='running'",
            [id],
          )
          .catch(() => {});
        if (this.child === child) this.child = null;
      };
      child.once('error', failed);
      child.once('exit', failed);
    } catch {
      await this.db.query(
        "UPDATE atelier_catalog.catalog_sync_runs SET status='failed',phase='failed',error='Не вдалося запустити синхронізацію.',finished_at=now() WHERE id=$1",
        [id],
      );
    }
    return this.latest();
  }
  onModuleDestroy() {
    this.child?.kill('SIGTERM');
  }
}
