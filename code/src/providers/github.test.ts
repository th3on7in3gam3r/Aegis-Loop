import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { GitHubProvider } from './github.js';
import { redactGitError } from '../github/clone.js';

const SECRET = 'test-secret';

function sign(body: string): string {
  return `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
}

function prPayload(action = 'opened', sha = 'c'.repeat(40)) {
  return JSON.stringify({
    action,
    pull_request: { number: 12, head: { sha, ref: 'feature/x' } },
    repository: { name: 'api', owner: { login: 'acme' } },
  });
}

describe('GitHubProvider', () => {
  const provider = new GitHubProvider('token', SECRET);

  it('verifies a correctly signed webhook and rejects tampering', async () => {
    const body = prPayload();
    assert.equal(await provider.verifyWebhook(body, { 'x-hub-signature-256': sign(body) }), true);
    assert.equal(
      await provider.verifyWebhook(body + ' ', { 'x-hub-signature-256': sign(body) }),
      false
    );
    assert.equal(await provider.verifyWebhook(body, {}), false);
  });

  it('normalises a pull_request event with the pinned head SHA', () => {
    const event = provider.parseEvent(prPayload(), {
      'x-github-event': 'pull_request',
      'x-github-delivery': 'abc-123',
    });
    assert.deepEqual(event, {
      provider: 'github',
      deliveryId: 'abc-123',
      repo: 'acme/api',
      number: 12,
      headSha: 'c'.repeat(40),
      headBranch: 'feature/x',
      actor: 'acme',
    });
  });

  it('ignores other events and non-scanning actions', () => {
    assert.equal(provider.parseEvent(prPayload(), { 'x-github-event': 'push' }), null);
    assert.equal(
      provider.parseEvent(prPayload('closed'), { 'x-github-event': 'pull_request' }),
      null
    );
  });

  it('falls back to a commit-scoped delivery id', () => {
    const event = provider.parseEvent(prPayload(), { 'x-github-event': 'pull_request' });
    assert.equal(event?.deliveryId, `acme/api#12@${'c'.repeat(40)}`);
  });
});

describe('redactGitError', () => {
  it('removes tokens from URLs, auth headers and raw text', () => {
    const msg =
      "fatal: unable to access 'https://x-access-token:ghp_secret@github.com/a/b.git/': " +
      'Authorization: Basic eC1hY2Nlc3M= failed; token ghp_secret';
    const out = redactGitError(msg, 'ghp_secret');
    assert.equal(out.includes('ghp_secret'), false);
    assert.equal(out.includes('eC1hY2Nlc3M='), false);
    assert.match(out, /https:\/\/\*\*\*@github\.com/);
  });
});
