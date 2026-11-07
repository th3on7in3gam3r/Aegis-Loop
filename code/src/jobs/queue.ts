import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { dbConfigured, dbQuery, loadBlob } from '../db.js';
import type { PullRequestEvent } from '../providers/types.js';

/**
 * Durable scan job queue.
 *
 * Webhooks enqueue and return immediately; a single in-process worker runs
 * jobs with retries and backoff. Each job is its own row in the `aegis_scan_jobs`
 * table (or a JSON file in dev), and `enqueue` only resolves after that row
 * is written — so a "queued" webhook response means the job is durably saved
 * and a restart or deploy resumes it.
 *
 * Deduplication: one job per provider + repo + PR + commit SHA. Webhook
 * redeliveries and repeated events for the same commit collapse onto the
 * existing job; a commit whose job permanently failed can be enqueued again.
 */

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface JobHistoryEntry {
  at: string;
  status: JobStatus;
  note?: string;
}

export interface ScanJob {
  id: string;
  dedupeKey: string;
  deliveryIds: string[];
  event: PullRequestEvent;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  createdAt: string;
  updatedAt: string;
  scanId?: string;
  error?: string;
  /** Audit trail of every state change. */
  history: JobHistoryEntry[];
}

export type JobHandler = (job: ScanJob) => Promise<{ scanId?: string } | void>;

export interface QueueStorage {
  load(): Promise<ScanJob[]>;
  /** Must resolve only once the job is durably stored. */
  upsert(job: ScanJob): Promise<void>;
  remove(ids: string[]): Promise<void>;
}

export interface QueueOptions {
  storage?: QueueStorage;
  maxAttempts?: number;
  /** Base retry delay; doubles each attempt. */
  retryBaseMs?: number;
  pollMs?: number;
  /** Finished jobs kept for the audit trail. */
  keepFinished?: number;
  now?: () => number;
}

export function dedupeKeyFor(event: PullRequestEvent): string {
  return `${event.provider}:${event.repo}#${event.number}@${event.headSha}`;
}

const LEGACY_BLOB = 'scan_jobs';
/**
 * Namespaced so it can't collide with a `scan_jobs` table another app
 * already keeps in the same database (that collision crashed startup).
 */
const TABLE = 'aegis_scan_jobs';
let tableReady: Promise<void> | null = null;

function ensureTable(): Promise<void> {
  tableReady ??= dbQuery(
    `CREATE TABLE IF NOT EXISTS ${TABLE} (
       id TEXT PRIMARY KEY,
       dedupe_key TEXT NOT NULL,
       status TEXT NOT NULL,
       data JSONB NOT NULL,
       updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`
  )
    .then(() => dbQuery(`CREATE INDEX IF NOT EXISTS ${TABLE}_status_idx ON ${TABLE} (status)`))
    .then(() => undefined)
    .catch((err) => {
      tableReady = null;
      throw err;
    });
  return tableReady;
}

export function postgresStorage(): QueueStorage {
  const upsert = async (job: ScanJob) => {
    await ensureTable();
    await dbQuery(
      `INSERT INTO ${TABLE} (id, dedupe_key, status, data, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, now())
       ON CONFLICT (id) DO UPDATE
         SET status = EXCLUDED.status, data = EXCLUDED.data, updated_at = now()`,
      [job.id, job.dedupeKey, job.status, JSON.stringify(job)]
    );
  };
  return {
    async load() {
      await ensureTable();
      const res = await dbQuery<{ data: ScanJob }>(`SELECT data FROM ${TABLE}`);
      if (res.rows.length > 0) return res.rows.map((r) => r.data);
      // One-time import from the earlier whole-collection blob.
      const legacy = (await loadBlob<ScanJob[]>(LEGACY_BLOB)) ?? [];
      for (const job of legacy) await upsert(job);
      return legacy;
    },
    upsert,
    async remove(ids) {
      if (ids.length === 0) return;
      await ensureTable();
      await dbQuery(`DELETE FROM ${TABLE} WHERE id = ANY($1::text[])`, [ids]);
    },
  };
}

export function fileStorage(file = join(config.dataDir, 'scan-jobs.json')): QueueStorage {
  const jobs = new Map<string, ScanJob>();
  const write = () => {
    mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(file, JSON.stringify([...jobs.values()], null, 2));
  };
  return {
    async load() {
      if (!existsSync(file)) return [];
      try {
        for (const job of JSON.parse(readFileSync(file, 'utf8')) as ScanJob[]) jobs.set(job.id, job);
      } catch {
        /* corrupt file — start fresh */
      }
      return [...jobs.values()];
    },
    async upsert(job) {
      jobs.set(job.id, structuredClone(job));
      write();
    },
    async remove(ids) {
      for (const id of ids) jobs.delete(id);
      write();
    },
  };
}

export function defaultStorage(): QueueStorage {
  return dbConfigured() ? postgresStorage() : fileStorage();
}

export class ScanJobQueue {
  private jobs = new Map<string, ScanJob>();
  private handler: JobHandler | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = true;
  private readonly storage: QueueStorage;
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;
  private readonly pollMs: number;
  private readonly keepFinished: number;
  private readonly now: () => number;

  constructor(opts: QueueOptions = {}) {
    this.storage = opts.storage ?? defaultStorage();
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.retryBaseMs = opts.retryBaseMs ?? 30_000;
    this.pollMs = opts.pollMs ?? 2_000;
    this.keepFinished = opts.keepFinished ?? 500;
    this.now = opts.now ?? Date.now;
  }

  /** Load persisted jobs. Jobs left `running` by a crash go back to the queue. */
  async load(): Promise<void> {
    let saved: ScanJob[];
    try {
      saved = await this.storage.load();
    } catch (err) {
      // Serve the site even if the queue's storage is unhappy; new jobs will
      // surface write errors on enqueue.
      console.error('[jobs] could not load scan jobs:', err instanceof Error ? err.message : err);
      return;
    }
    for (const job of saved) {
      this.jobs.set(job.id, job);
      if (job.status === 'running') {
        this.transition(job, 'queued', 'recovered after restart');
        await this.save(job);
      }
    }
  }

  /**
   * Resolves once the job is durably stored. If storage fails this throws,
   * so the webhook answers with an error and the provider redelivers.
   */
  async enqueue(event: PullRequestEvent): Promise<{ job: ScanJob; duplicate: boolean }> {
    const key = dedupeKeyFor(event);
    const existing = [...this.jobs.values()].find(
      (j) => j.dedupeKey === key && j.status !== 'failed'
    );
    if (existing) {
      if (!existing.deliveryIds.includes(event.deliveryId)) {
        existing.deliveryIds.push(event.deliveryId);
        existing.history.push({
          at: this.iso(),
          status: existing.status,
          note: `duplicate delivery ${event.deliveryId}`,
        });
        await this.save(existing);
      }
      return { job: existing, duplicate: true };
    }

    const at = this.iso();
    const job: ScanJob = {
      id: randomUUID(),
      dedupeKey: key,
      deliveryIds: [event.deliveryId],
      event,
      status: 'queued',
      attempts: 0,
      maxAttempts: this.maxAttempts,
      runAfter: at,
      createdAt: at,
      updatedAt: at,
      history: [{ at, status: 'queued', note: `delivery ${event.deliveryId}` }],
    };
    // Reserve the dedupe key in memory first so a concurrent redelivery
    // collapses onto this job, then roll back if the write fails.
    this.jobs.set(job.id, job);
    try {
      await this.storage.upsert(job);
    } catch (err) {
      this.jobs.delete(job.id);
      throw err;
    }
    this.kick();
    return { job, duplicate: false };
  }

  get(id: string): ScanJob | undefined {
    return this.jobs.get(id);
  }

  list(): ScanJob[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  start(handler: JobHandler): void {
    this.handler = handler;
    this.stopped = false;
    this.kick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Run every job that is due right now, one at a time. Returns how many ran. */
  async drain(): Promise<number> {
    let ran = 0;
    while (await this.runNext()) ran += 1;
    return ran;
  }

  private kick(): void {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, 0);
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    await this.drain();
    if (!this.stopped && !this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.tick();
      }, this.pollMs);
      this.timer.unref?.();
    }
  }

  private nextDue(): ScanJob | undefined {
    const now = this.now();
    return [...this.jobs.values()]
      .filter((j) => j.status === 'queued' && Date.parse(j.runAfter) <= now)
      .sort((a, b) => a.runAfter.localeCompare(b.runAfter))[0];
  }

  private async runNext(): Promise<boolean> {
    if (this.running || !this.handler) return false;
    const job = this.nextDue();
    if (!job) return false;

    this.running = true;
    job.attempts += 1;
    this.transition(job, 'running', `attempt ${job.attempts}/${job.maxAttempts}`);
    await this.save(job);

    try {
      const result = await this.handler(job);
      if (result && result.scanId) job.scanId = result.scanId;
      job.error = undefined;
      this.transition(job, 'done', job.scanId ? `scan ${job.scanId}` : undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      job.error = message;
      if (job.attempts < job.maxAttempts) {
        const delay = this.retryBaseMs * 2 ** (job.attempts - 1);
        job.runAfter = new Date(this.now() + delay).toISOString();
        this.transition(job, 'queued', `retry in ${Math.round(delay / 1000)}s: ${message}`);
      } else {
        this.transition(job, 'failed', message);
      }
    } finally {
      await this.save(job);
      await this.prune();
      this.running = false;
    }
    return true;
  }

  private transition(job: ScanJob, status: JobStatus, note?: string): void {
    const at = this.iso();
    job.status = status;
    job.updatedAt = at;
    job.history.push(note ? { at, status, note } : { at, status });
  }

  private async prune(): Promise<void> {
    const finished = this.list().filter((j) => j.status === 'done' || j.status === 'failed');
    const stale = finished.slice(this.keepFinished).map((j) => j.id);
    if (stale.length === 0) return;
    for (const id of stale) this.jobs.delete(id);
    try {
      await this.storage.remove(stale);
    } catch (err) {
      console.error('[jobs] failed to prune finished jobs:', err instanceof Error ? err.message : err);
    }
  }

  /**
   * State-change writes after enqueue. A failure is logged, not thrown: the
   * worst case is a job re-running after a restart, which dedupe and the
   * idempotent PR comment update make harmless.
   */
  private async save(job: ScanJob): Promise<void> {
    try {
      await this.storage.upsert(job);
    } catch (err) {
      console.error(`[jobs] failed to persist job ${job.id}:`, err instanceof Error ? err.message : err);
    }
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }
}
