import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  signStudioOpsBody,
  studioOpsConfigured,
  emitStudioOpsEvent,
} from './studioOps.js';

describe('studioOps', () => {
  const env = { ...process.env };

  beforeEach(() => {
    delete process.env.STUDIO_OPS_URL;
    delete process.env.STUDIO_OPS_WEBHOOK_URL;
    delete process.env.STUDIO_OPS_WEBHOOK_SECRET;
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it('is not configured without env vars', () => {
    assert.equal(studioOpsConfigured(), false);
  });

  it('is configured when STUDIO_OPS_URL and secret are set', () => {
    process.env.STUDIO_OPS_URL = 'http://localhost:3010';
    process.env.STUDIO_OPS_WEBHOOK_SECRET = 'test-secret';
    assert.equal(studioOpsConfigured(), true);
  });

  it('is configured with legacy STUDIO_OPS_WEBHOOK_URL', () => {
    process.env.STUDIO_OPS_WEBHOOK_URL = 'https://ops.example/api/events';
    process.env.STUDIO_OPS_WEBHOOK_SECRET = 'test-secret';
    assert.equal(studioOpsConfigured(), true);
  });

  it('signs webhook bodies with HMAC-SHA256', () => {
    const body = JSON.stringify({
      product: 'aegis',
      event: 'user.signup',
      externalUserId: 'octocat',
    });
    const sig = signStudioOpsBody(body, 'test-secret');
    assert.equal(sig, signStudioOpsBody(body, 'test-secret'));
    assert.notEqual(sig, signStudioOpsBody(body, 'other-secret'));
  });

  it('posts ingest payload to /api/events', async () => {
    process.env.STUDIO_OPS_URL = 'http://localhost:3010';
    process.env.STUDIO_OPS_WEBHOOK_SECRET = 'test-secret';

    const calls: Array<{ url: string; init: RequestInit }> = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ ok: true }), { status: 201 });
    }) as typeof fetch;

    try {
      emitStudioOpsEvent({
        event: 'user.signup',
        email: 'octocat@example.com',
        externalUserId: 'octocat',
        metadata: { authMethod: 'oauth' },
      });
      await new Promise((r) => setTimeout(r, 20));

      assert.equal(calls.length, 1);
      assert.equal(calls[0]!.url, 'http://localhost:3010/api/events');
      const body = JSON.parse(String(calls[0]!.init.body)) as {
        product: string;
        event: string;
        email: string;
        externalUserId: string;
        metadata: { authMethod: string };
      };
      assert.equal(body.product, 'aegis');
      assert.equal(body.event, 'user.signup');
      assert.equal(body.email, 'octocat@example.com');
      assert.equal(body.externalUserId, 'octocat');
      assert.equal(body.metadata.authMethod, 'oauth');
      const headers = calls[0]!.init.headers as Record<string, string>;
      assert.match(headers['X-Studio-Ops-Signature']!, /^[a-f0-9]{64}$/);
    } finally {
      globalThis.fetch = original;
    }
  });
});
