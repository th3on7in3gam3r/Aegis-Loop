import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { ForgejoProvider, statusFor, validateForgejoUrl, type FetchLike } from './forgejo.js';
import { BOT_COMMENT_MARKER } from '../github/pr.js';
import { handleForgejoWebhook, runPrScan } from '../github/webhooks.js';
import { ScanJobQueue, type QueueStorage, type ScanJob } from '../jobs/queue.js';
import type { ScanResult } from '../types.js';

const SECRET = 'forge-secret';
const BASE = 'https://forge.example.com';
const SHA = 'f'.repeat(40);

function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('hex');
}

function prBody(action = 'opened') {
  return JSON.stringify({
    action,
    number: 5,
    pull_request: { number: 5, head: { sha: SHA, ref: 'feature/scan-me' } },
    repository: { full_name: 'forge-one/app', name: 'app', owner: { login: 'forge-one' } },
    sender: { login: 'jerless' },
  });
}

type Call = { method: string; path: string; body?: unknown; auth?: string };

/** Minimal fake Forgejo API that records every call. */
function fakeForgejo(opts: { comments?: unknown[]; status?: Record<string, number> } = {}) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const path = url.replace(`${BASE}/api/v1`, '');
    const method = init?.method ?? 'GET';
    const auth = (init?.headers as Record<string, string>)?.Authorization;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body, auth });
    const forced = opts.status?.[`${method} ${path}`];
    if (forced) return new Response('denied', { status: forced });

    if (path === '/user') return Response.json({ login: 'aegis-bot' });
    if (method === 'GET' && path.endsWith('/pulls/5')) {
      return Response.json({
        number: 5,
        html_url: `${BASE}/forge-one/app/pulls/5`,
        title: 'Add login form',
        head: { ref: 'feature/scan-me', sha: 'a'.repeat(40) },
        base: { ref: 'main' },
      });
    }
    if (method === 'GET' && path.endsWith('/issues/5/comments')) return Response.json(opts.comments ?? []);
    if (method === 'POST' && path.endsWith('/issues/5/comments')) {
      return Response.json({ id: 99, html_url: `${BASE}/forge-one/app/pulls/5#issuecomment-99` });
    }
    if (method === 'PATCH') return Response.json({ id: 42, html_url: `${BASE}/c/42` });
    if (method === 'POST' && path.includes('/statuses/')) return Response.json({ id: 1 }, { status: 201 });
    return new Response('not found', { status: 404 });
  };
  return { calls, fetchImpl };
}

function provider(fetchImpl?: FetchLike) {
  return new ForgejoProvider({ baseUrl: BASE, token: 'fj-token', webhookSecret: SECRET, fetch: fetchImpl });
}

function scan(overrides: Partial<ScanResult['stats']> = {}): ScanResult {
  return {
    id: 'scan-1',
    repo: 'forge-one/app',
    branch: 'feature/scan-me',
    findings: [],
    stats: { critical: 0, warning: 0, info: 0, score: 100, ...overrides },
    pullRequest: {
      number: 5,
      url: '',
      title: 'Add login form',
      headBranch: 'feature/scan-me',
      baseBranch: 'main',
      headSha: SHA,
    },
  } as unknown as ScanResult;
}

function memoryStorage(): QueueStorage {
  const rows = new Map<string, ScanJob>();
  return {
    async load() {
      return [...rows.values()];
    },
    async upsert(job) {
      rows.set(job.id, structuredClone(job));
    },
    async remove(ids) {
      ids.forEach((id) => rows.delete(id));
    },
  };
}

describe('ForgejoProvider webhooks', () => {
  it('accepts a valid Forgejo signature and rejects anything else', async () => {
    const body = prBody();
    const p = provider();
    assert.equal(await p.verifyWebhook(body, { 'x-forgejo-signature': sign(body) }), true);
    assert.equal(await p.verifyWebhook(body, { 'x-gitea-signature': sign(body) }), true, 'Gitea header');
    assert.equal(await p.verifyWebhook(body + 'x', { 'x-forgejo-signature': sign(body) }), false);
    assert.equal(await p.verifyWebhook(body, { 'x-forgejo-signature': 'not-hex' }), false);
    assert.equal(await p.verifyWebhook(body, {}), false);
  });

  it('parses opened and synchronized PR events pinned to the head SHA', () => {
    const p = provider();
    const headers = { 'x-forgejo-event': 'pull_request', 'x-forgejo-delivery': 'del-1' };
    assert.deepEqual(p.parseEvent(prBody('synchronized'), headers), {
      provider: 'forgejo',
      deliveryId: 'del-1',
      repo: 'forge-one/app',
      number: 5,
      headSha: SHA,
      headBranch: 'feature/scan-me',
      actor: 'forge-one',
    });
    assert.equal(p.parseEvent(prBody('closed'), headers), null);
    assert.equal(p.parseEvent(prBody(), { 'x-forgejo-event': 'push' }), null);
  });
});

describe('handleForgejoWebhook', () => {
  it('queues once and treats a redelivery as a duplicate', async () => {
    const queue = new ScanJobQueue({ storage: memoryStorage() });
    const body = prBody();
    const headers = {
      'x-forgejo-event': 'pull_request',
      'x-forgejo-delivery': 'del-7',
      'x-forgejo-signature': sign(body),
    };
    const first = await handleForgejoWebhook(body, headers, provider(), queue);
    const again = await handleForgejoWebhook(body, headers, provider(), queue);
    assert.equal(first.queued, true);
    assert.equal(again.duplicate, true);
    assert.equal(again.jobId, first.jobId);
    assert.equal(queue.list().length, 1);
  });

  it('rejects a bad signature without queueing', async () => {
    const queue = new ScanJobQueue({ storage: memoryStorage() });
    await assert.rejects(
      handleForgejoWebhook(prBody(), { 'x-forgejo-event': 'pull_request', 'x-forgejo-signature': 'a'.repeat(64) }, provider(), queue),
      /signature/
    );
    assert.equal(queue.list().length, 0);
  });
});

describe('ForgejoProvider API', () => {
  it('maps a pull request', async () => {
    const { fetchImpl, calls } = fakeForgejo();
    const pr = await provider(fetchImpl).getPullRequest('forge-one/app', 5);
    assert.equal(pr.title, 'Add login form');
    assert.equal(pr.baseBranch, 'main');
    assert.equal(calls[0].auth, 'token fj-token');
  });

  it('posts a new comment and a status on the scanned commit', async () => {
    const { fetchImpl, calls } = fakeForgejo();
    const result = await provider(fetchImpl).publishReview(scan({ critical: 1 }), 'https://aegis/app');
    const post = calls.find((c) => c.method === 'POST' && c.path.endsWith('/comments'));
    const status = calls.find((c) => c.path.includes('/statuses/'));
    assert.ok(String((post?.body as { body: string }).body).startsWith(BOT_COMMENT_MARKER));
    assert.equal(status?.path, `/repos/forge-one/app/statuses/${SHA}`);
    assert.deepEqual(status?.body, statusFor(scan({ critical: 1 }), 'https://aegis/app'));
    assert.equal((status?.body as { state: string }).state, 'failure');
    assert.match(result.commentUrl, /issuecomment-99/);
  });

  it('updates its own comment but never one a different user wrote', async () => {
    const comments = [
      { id: 41, body: `${BOT_COMMENT_MARKER} copied`, user: { login: 'someone-else' } },
      { id: 42, body: `${BOT_COMMENT_MARKER}\nold scan`, user: { login: 'aegis-bot' } },
    ];
    const { fetchImpl, calls } = fakeForgejo({ comments });
    await provider(fetchImpl).publishReview(scan(), 'https://aegis/app');
    const patch = calls.find((c) => c.method === 'PATCH');
    assert.equal(patch?.path, '/repos/forge-one/app/issues/comments/42');
    assert.equal(calls.filter((c) => c.method === 'POST' && c.path.endsWith('/comments')).length, 0);
  });

  it('explains missing permissions clearly', async () => {
    const { fetchImpl } = fakeForgejo({ status: { [`POST /repos/forge-one/app/statuses/${SHA}`]: 403 } });
    await assert.rejects(
      provider(fetchImpl).publishReview(scan(), 'https://aegis/app'),
      /lacks permission .*HTTP 403/
    );
  });

  it('maps warnings to the warning state', () => {
    assert.equal(statusFor(scan({ warning: 2 }), 'u').state, 'warning');
    assert.equal(statusFor(scan(), 'u').state, 'success');
  });
});

describe('runPrScan with a failing checkout', () => {
  it('propagates the failure so the queue retries, without publishing', async () => {
    const { fetchImpl, calls } = fakeForgejo();
    const p = provider(fetchImpl);
    p.checkoutCommit = async () => {
      throw new Error('clone failed');
    };
    await assert.rejects(
      runPrScan(p, {
        provider: 'forgejo',
        deliveryId: 'd',
        repo: 'forge-one/app',
        number: 5,
        headSha: SHA,
        headBranch: 'feature/scan-me',
        actor: 'forge-one',
      }),
      /clone failed/
    );
    assert.equal(calls.some((c) => c.path.includes('/statuses/') || c.method === 'POST'), false);
  });
});

describe('validateForgejoUrl', () => {
  it('accepts an https origin and localhost over http', () => {
    assert.equal(validateForgejoUrl('https://git.example.com'), 'https://git.example.com');
    assert.equal(validateForgejoUrl('http://127.0.0.1:3300'), 'http://127.0.0.1:3300');
  });

  it('rejects plain http, embedded credentials and paths', () => {
    assert.throws(() => validateForgejoUrl('http://git.example.com'), /https/);
    assert.throws(() => validateForgejoUrl('https://user:pw@git.example.com'), /credentials/);
    assert.throws(() => validateForgejoUrl('https://git.example.com/evil?x=1'), /origin/);
    assert.throws(() => validateForgejoUrl('not a url'), /valid URL/);
  });

  it('disables the provider instead of throwing on a bad URL', () => {
    const p = new ForgejoProvider({ baseUrl: 'http://evil.example.com', token: 't', webhookSecret: 's' });
    assert.equal(p.configured, false);
  });
});
