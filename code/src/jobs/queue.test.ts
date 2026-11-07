import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ScanJobQueue, type QueueStorage, type ScanJob } from './queue.js';
import type { PullRequestEvent } from '../providers/types.js';

function memoryStorage(initial: ScanJob[] = []): QueueStorage & { saved: ScanJob[] } {
  const store = {
    saved: initial,
    async load() {
      return structuredClone(store.saved);
    },
    save(jobs: ScanJob[]) {
      store.saved = structuredClone(jobs);
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
  it('collapses a redelivered webhook onto the existing job', () => {
    const q = new ScanJobQueue({ storage: memoryStorage() });
    const first = q.enqueue(event());
    const again = q.enqueue(event());
    const otherDelivery = q.enqueue(event({ deliveryId: 'delivery-2' }));

    assert.equal(first.duplicate, false);
    assert.equal(again.duplicate, true);
    assert.equal(otherDelivery.duplicate, true);
    assert.equal(again.job.id, first.job.id);
    assert.deepEqual(first.job.deliveryIds, ['delivery-1', 'delivery-2']);
    assert.equal(q.list().length, 1);
  });

  it('queues a new job for a new commit on the same PR', () => {
    const q = new ScanJobQueue({ storage: memoryStorage() });
    q.enqueue(event());
    const next = q.enqueue(event({ deliveryId: 'd2', headSha: 'b'.repeat(40) }));
    assert.equal(next.duplicate, false);
    assert.equal(q.list().length, 2);
  });

  it('runs a job once and records the scan id', async () => {
    const q = new ScanJobQueue({ storage: memoryStorage() });
    let calls = 0;
    const { job } = q.enqueue(event());
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
    const { job } = q.enqueue(event());
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
    q.enqueue(event());
    q.start(async () => {
      throw new Error('boom');
    });
    q.stop();
    await q.drain();
    const retry = q.enqueue(event({ deliveryId: 'manual-retry' }));
    assert.equal(retry.duplicate, false);
  });

  it('persists jobs and requeues ones interrupted mid-run', async () => {
    const storage = memoryStorage();
    const q1 = new ScanJobQueue({ storage });
    const { job } = q1.enqueue(event());
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
});
