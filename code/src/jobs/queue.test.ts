import { after, describe, it } from 'node:test';
import { newDb } from 'pg-mem';
import { __setPoolForTests } from '../db.js';
import assert from 'node:assert/strict';
import { postgresStorage, ScanJobQueue, type QueueStorage, type ScanJob } from './queue.js';
import type { PullRequestEvent } from '../providers/types.js';

function memoryStorage(initial: ScanJob[] = []): QueueStorage & { saved: ScanJob[]; failNext: boolean } {
  const store = {
    saved: initial,
    failNext: false,
    async load() {
      return structuredClone(store.saved);
    },
    async upsert(job: ScanJob) {
      if (store.failNext) {
        store.failNext = false;
        throw new Error('db down');
      }
      store.saved = [...store.saved.filter((j) => j.id !== job.id), structuredClone(job)];
    },
    async remove(ids: string[]) {
      store.saved = store.saved.filter((j) => !ids.includes(j.id));
    },
  };
  return store;
}

function event(overrides: Partial<PullRequestEvent> = {}): PullRequestEvent {
  return {
    provider: 'github',
    deliveryId: 'delivery-1',
    repo: 'acme/api',
    number: 7,
    headSha: 'a'.repeat(40),
    headBranch: 'feature',
    actor: 'acme',
    ...overrides,
  };
}

function clock(start = Date.parse('2026-11-07T12:00:00Z')) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('ScanJobQueue', () => {
  it('collapses a redelivered webhook onto the existing job', async () => {
    const q = new ScanJobQueue({ storage: memoryStorage() });
    const first = await q.enqueue(event());
    const again = await q.enqueue(event());
    const otherDelivery = await q.enqueue(event({ deliveryId: 'delivery-2' }));

    assert.equal(first.duplicate, false);
    assert.equal(again.duplicate, true);
    assert.equal(otherDelivery.duplicate, true);
    assert.equal(again.job.id, first.job.id);
    assert.deepEqual(first.job.deliveryIds, ['delivery-1', 'delivery-2']);
    assert.equal(q.list().length, 1);
  });

  it('queues a new job for a new commit on the same PR', async () => {
    const q = new ScanJobQueue({ storage: memoryStorage() });
    await q.enqueue(event());
    const next = await q.enqueue(event({ deliveryId: 'd2', headSha: 'b'.repeat(40) }));
    assert.equal(next.duplicate, false);
    assert.equal(q.list().length, 2);
  });

  it('runs a job once and records the scan id', async () => {
    const q = new ScanJobQueue({ storage: memoryStorage() });
    let calls = 0;
    const { job } = await q.enqueue(event());
    q.start(async () => {
      calls += 1;
      return { scanId: 'scan-1' };
    });
    q.stop();
    await q.drain();

    assert.equal(calls, 1);
    assert.equal(q.get(job.id)?.status, 'done');
    assert.equal(q.get(job.id)?.scanId, 'scan-1');
    assert.deepEqual(
      q.get(job.id)?.history.map((h) => h.status),
      ['queued', 'running', 'done']
    );
  });

  it('retries with backoff, then fails permanently', async () => {
    const c = clock();
    const q = new ScanJobQueue({ storage: memoryStorage(), maxAttempts: 2, retryBaseMs: 1000, now: c.now });
    const { job } = await q.enqueue(event());
    q.start(async () => {
      throw new Error('boom');
    });
    q.stop();

    assert.equal(await q.drain(), 1);
    assert.equal(q.get(job.id)?.status, 'queued');
    assert.equal(await q.drain(), 0, 'not due until backoff elapses');

    c.advance(1000);
    assert.equal(await q.drain(), 1);
    assert.equal(q.get(job.id)?.status, 'failed');
    assert.equal(q.get(job.id)?.error, 'boom');
  });

  it('allows re-enqueueing a commit whose job failed', async () => {
    const q = new ScanJobQueue({ storage: memoryStorage(), maxAttempts: 1 });
    await q.enqueue(event());
    q.start(async () => {
      throw new Error('boom');
    });
    q.stop();
    await q.drain();
    const retry = await q.enqueue(event({ deliveryId: 'manual-retry' }));
    assert.equal(retry.duplicate, false);
  });

  it('persists jobs and requeues ones interrupted mid-run', async () => {
    const storage = memoryStorage();
    const q1 = new ScanJobQueue({ storage });
    const { job } = await q1.enqueue(event());
    storage.saved = storage.saved.map((j) => ({ ...j, status: 'running' as const }));

    const q2 = new ScanJobQueue({ storage });
    await q2.load();
    assert.equal(q2.get(job.id)?.status, 'queued');
    assert.match(q2.get(job.id)?.history.at(-1)?.note ?? '', /recovered/);

    q2.start(async () => ({ scanId: 's' }));
    q2.stop();
    await q2.drain();
    assert.equal(q2.get(job.id)?.status, 'done');
    assert.equal(storage.saved[0].status, 'done');
  });

  it('only reports queued once the job is stored, and rolls back on failure', async () => {
    const storage = memoryStorage();
    const q = new ScanJobQueue({ storage });
    storage.failNext = true;
    await assert.rejects(q.enqueue(event()), /db down/);
    assert.equal(q.list().length, 0, 'failed write leaves no phantom job');

    const { job } = await q.enqueue(event());
    assert.equal(storage.saved.find((j) => j.id === job.id)?.status, 'queued');
  });
});

describe('postgresStorage', () => {
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  __setPoolForTests(new Pool());
  after(() => __setPoolForTests(null));

  it('writes one row per job and survives a restart', async () => {
    const q1 = new ScanJobQueue({ storage: postgresStorage() });
    const { job } = await q1.enqueue(event());
    await q1.enqueue(event({ deliveryId: 'redelivery' }));

    const q2 = new ScanJobQueue({ storage: postgresStorage() });
    await q2.load();
    assert.equal(q2.list().length, 1);
    assert.deepEqual(q2.get(job.id)?.deliveryIds, ['delivery-1', 'redelivery']);

    q2.start(async () => ({ scanId: 'scan-9' }));
    q2.stop();
    await q2.drain();
    const q3 = new ScanJobQueue({ storage: postgresStorage() });
    await q3.load();
    assert.equal(q3.get(job.id)?.status, 'done');
    assert.equal(q3.get(job.id)?.scanId, 'scan-9');
  });

  it('ignores an unrelated scan_jobs table another app created', async () => {
    const { dbQuery } = await import('../db.js');
    await dbQuery('CREATE TABLE IF NOT EXISTS scan_jobs (job_id INT, payload TEXT)');
    const q = new ScanJobQueue({ storage: postgresStorage() });
    await q.load();
    const { job } = await q.enqueue(event({ deliveryId: 'collision-check', headSha: 'e'.repeat(40) }));
    assert.equal(q.get(job.id)?.status, 'queued');
  });
});
