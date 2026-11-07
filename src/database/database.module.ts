import { Global, Module } from '@nestjs/common';
import { Pool } from 'pg';
import { DatabaseService } from './database.service.js';

@Global()
@Module({
  providers: [
    {
      provide: Pool,
      useFactory: () => {
        if (!process.env.DATABASE_URL) {
          throw new Error(
            'Set DATABASE_URL in backend/.env to connect PostgreSQL',
          );
        }
        const pool = new Pool({
          connectionString: process.env.DATABASE_URL,
          connectionTimeoutMillis: 5000,
          query_timeout: 10000,
          max: 10,
        });
        pool.on('error', () =>
          console.error('PostgreSQL idle connection error'),
        );
        return pool;
      },
    },
    DatabaseService,
  ],
  exports: [Pool, DatabaseService],
})
export class DatabaseModule {}
