import pg from 'pg';

/**
 * Postgres-backed blob storage (Neon or any DATABASE_URL).
 *
 * Each store (scans, accounts, sessions, …) persists its full JSON payload
 * into one row of app_store. Stores keep their synchronous in-memory Map
 * API; writes are queued and flushed asynchronously per store, so a slow
 * network write never blocks a request. Without DATABASE_URL the stores
 * fall back to local JSON files (dev/tests).
 */

let pool: pg.Pool | null = null;
let ready: Promise<void> | null = null;
let testPool: pg.Pool | null = null;

export function dbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL) || testPool !== null;
}

/** Test hook: inject an in-memory pg-mem pool. */
export function __setPoolForTests(p: pg.Pool | null): void {
  testPool = p;
  pool = null;
  ready = null;
}

function getPool(): pg.Pool {
  if (testPool) return testPool;
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      idleTimeoutMillis: 30_000,
    });
  }
  return pool;
}

async function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = getPool()
      .query(
        `CREATE TABLE IF NOT EXISTS app_store (
           name TEXT PRIMARY KEY,
           data JSONB NOT NULL,
           updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
         )`
      )
      .then(() => undefined);
  }
  return ready;
}

export async function loadBlob<T>(name: string): Promise<T | null> {
  await ensureSchema();
  const res = await getPool().query('SELECT data FROM app_store WHERE name = $1', [name]);
  return res.rows[0]?.data ?? null;
}

// One in-flight write per store; if more writes arrive meanwhile, coalesce
// them into a single trailing write with the latest payload.
const writing = new Map<string, { pending: unknown | undefined }>();

export function saveBlob(name: string, data: unknown): void {
  const state = writing.get(name);
  if (state) {
    state.pending = data;
    return;
  }
  writing.set(name, { pending: undefined });
  void flush(name, data);
}

async function flush(name: string, data: unknown): Promise<void> {
  try {
    await ensureSchema();
    await getPool().query(
      `INSERT INTO app_store (name, data, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [name, JSON.stringify(data)]
    );
  } catch (err) {
    console.error(`[db] failed to persist store "${name}":`, err instanceof Error ? err.message : err);
  } finally {
    const state = writing.get(name);
    writing.delete(name);
    if (state?.pending !== undefined) saveBlob(name, state.pending);
  }
}

/** Wait for queued writes to settle (used by tests / graceful shutdown). */
export async function flushAll(): Promise<void> {
  while (writing.size > 0) {
    await new Promise((r) => setTimeout(r, 25));
  }
}

export async function closeDb(): Promise<void> {
  await flushAll();
  if (pool) {
    await pool.end();
    pool = null;
    ready = null;
  }
}
