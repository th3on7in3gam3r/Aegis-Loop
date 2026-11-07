import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { dbConfigured, loadBlob, saveBlob } from '../db.js';
import type { PullRequestEvent } from '../providers/types.js';

/**
 * Durable scan job queue.
 *
 * Webhooks enqueue and return immediately; a single in-process worker runs
 * jobs with retries and backoff. Jobs persist the same way as other stores
 * (Postgres blob, or a JSON file in dev), so a restart or deploy resumes
 * queued work instead of dropping it.
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
  save(jobs: ScanJob[]): void;
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

const BLOB_NAME = 'scan_jobs';

export function defaultStorage(): QueueStorage {
  const file = join(config.dataDir, 'scan-jobs.json');
  return {
    async load() {
      if (dbConfigured()) return (await loadBlob<ScanJob[]>(BLOB_NAME)) ?? [];
      if (!existsSync(file)) return [];
      try {
        return JSON.parse(readFileSync(file, 'utf8')) as ScanJob[];
      } catch {
        return [];
      }
    },
    save(jobs) {
      if (dbConfigured()) {
        saveBlob(BLOB_NAME, jobs);
        return;
      }
      try {
        mkdirSync(config.dataDir, { recursive: true });
        writeFileSync(file, JSON.stringify(jobs, null, 2));
      } catch {
        /* keep in memory */
      }
    },
  };
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
    const saved = await this.storage.load();
    for (const job of saved) {
      if (job.status === 'running') {
        this.transition(job, 'queued', 'recovered after restart');
      }
      this.jobs.set(job.id, job);
    }
    this.persist();
  }

  enqueue(event: PullRequestEvent): { job: ScanJob; duplicate: boolean } {
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
        this.persist();
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
    this.jobs.set(job.id, job);
    this.persist();
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
    this.persist();

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
      this.running = false;
      this.prune();
      this.persist();
    }
    return true;
  }

  private transition(job: ScanJob, status: JobStatus, note?: string): void {
    const at = this.iso();
    job.status = status;
    job.updatedAt = at;
    job.history.push(note ? { at, status, note } : { at, status });
  }

  private prune(): void {
    const finished = this.list().filter((j) => j.status === 'done' || j.status === 'failed');
    for (const job of finished.slice(this.keepFinished)) this.jobs.delete(job.id);
  }

  private persist(): void {
    this.storage.save(this.list());
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }
}
