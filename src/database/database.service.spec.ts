import { DatabaseService } from './database.service.js';

describe('DatabaseService', () => {
  it('rejects startup when PostgreSQL is unavailable', async () => {
    const pool = {
      query: vi.fn().mockRejectedValue(new Error('secret connection details')),
      end: vi.fn(),
    };
    const service = new DatabaseService(pool as never);
    await expect(service.onModuleInit()).rejects.toThrow(
      'PostgreSQL connection failed',
    );
  });

  it('checks connectivity and closes the pool on shutdown', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] }),
      end: vi.fn().mockResolvedValue(undefined),
    };
    const service = new DatabaseService(pool as never);
    await service.onModuleInit();
    expect(pool.query).toHaveBeenCalledWith('SELECT 1 AS ok');
    await service.onModuleDestroy();
    expect(pool.end).toHaveBeenCalledOnce();
  });
});
