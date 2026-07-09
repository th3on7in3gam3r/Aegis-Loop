import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  signStudioOpsBody,
  studioOpsConfigured,
} from './studioOps.js';

describe('studioOps', () => {
  const env = { ...process.env };

  beforeEach(() => {
    delete process.env.STUDIO_OPS_WEBHOOK_URL;
    delete process.env.STUDIO_OPS_WEBHOOK_SECRET;
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it('is not configured without env vars', () => {
    assert.equal(studioOpsConfigured(), false);
  });

  it('is configured when URL and secret are set', () => {
    process.env.STUDIO_OPS_WEBHOOK_URL = 'https://studio.example/hooks/aegis';
    process.env.STUDIO_OPS_WEBHOOK_SECRET = 'test-secret';
    assert.equal(studioOpsConfigured(), true);
  });

  it('signs webhook bodies with HMAC-SHA256', () => {
    const body = JSON.stringify({
      type: 'user.signup',
      githubLogin: 'octocat',
      email: null,
    });
    const sig = signStudioOpsBody(body, 'test-secret');
    assert.equal(sig, signStudioOpsBody(body, 'test-secret'));
    assert.notEqual(sig, signStudioOpsBody(body, 'other-secret'));
  });
});
