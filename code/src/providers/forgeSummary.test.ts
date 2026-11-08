import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isForgejoScan,
  latestForgeScans,
  MAX_SUMMARY_REPOS,
  parseSummaryRequest,
  summaryTokenValid,
} from './forgeSummary.js';
import type { ScanResult } from '../types.js';

const ORIGIN = 'https://git.example.com';

function scan(over: Partial<ScanResult> & { repo: string }): ScanResult {
  return {
    id: Math.random().toString(36).slice(2),
    module: 'code',
    branch: 'main',
    status: 'complete',
    startedAt: '2026-11-01T10:00:00Z',
    completedAt: '2026-11-01T10:00:05Z',
    findings: [],
    stats: { critical: 0, warning: 0, info: 0, resolved: 0, score: 100 },
    provider: 'forgejo',
    pullRequest: {
      number: 1,
      url: `${ORIGIN}/${over.repo}/pulls/1`,
      title: 't',
      headBranch: 'feature',
      baseBranch: 'main',
      headSha: 'a'.repeat(40),
    },
    ...over,
  };
}

describe('summaryTokenValid', () => {
  it('accepts the exact Bearer token', () => {
    assert.equal(summaryTokenValid('Bearer s3cret-token', 's3cret-token'), true);
  });
  it('rejects wrong, missing or malformed tokens', () => {
    assert.equal(summaryTokenValid('Bearer wrong-token!', 's3cret-token'), false);
    assert.equal(summaryTokenValid('Bearer s3cret', 's3cret-token'), false);
    assert.equal(summaryTokenValid(undefined, 's3cret-token'), false);
    assert.equal(summaryTokenValid('s3cret-token', 's3cret-token'), false);
  });
  it('is disabled when no token is configured', () => {
    assert.equal(summaryTokenValid('Bearer ', ''), false);
    assert.equal(summaryTokenValid('Bearer anything', ''), false);
  });
});

describe('parseSummaryRequest', () => {
  it('requires provider forgejo and a repo array', () => {
    assert.ok('error' in parseSummaryRequest({ provider: 'github', repos: [] }));
    assert.ok('error' in parseSummaryRequest({ provider: 'forgejo' }));
    assert.ok('error' in parseSummaryRequest(null));
  });
  it('keeps valid owner/name strings, dedupes, drops junk', () => {
    const r = parseSummaryRequest({ provider: 'forgejo', repos: ['a/b', 'a/b', 'bad', 3, '../x/y', 'org/repo.js'] });
    assert.deepEqual(r, { repos: ['a/b', 'org/repo.js'] });
  });
  it('caps the number of repos', () => {
    const repos = Array.from({ length: MAX_SUMMARY_REPOS + 1 }, (_, i) => `o/r${i}`);
    assert.ok('error' in parseSummaryRequest({ provider: 'forgejo', repos }));
  });
});

describe('isForgejoScan', () => {
  it('uses the recorded provider when present', () => {
    assert.equal(isForgejoScan(scan({ repo: 'a/b', provider: 'forgejo' }), ORIGIN), true);
    assert.equal(isForgejoScan(scan({ repo: 'a/b', provider: 'github' }), ORIGIN), false);
  });
  it('falls back to the PR link origin for older scans', () => {
    assert.equal(isForgejoScan(scan({ repo: 'a/b', provider: undefined }), ORIGIN), true);
    const gh = scan({ repo: 'a/b', provider: undefined });
    gh.pullRequest!.url = 'https://github.com/a/b/pull/1';
    assert.equal(isForgejoScan(gh, ORIGIN), false);
    assert.equal(isForgejoScan(scan({ repo: 'a/b', provider: undefined, pullRequest: undefined }), ORIGIN), false);
  });
});

describe('latestForgeScans', () => {
  it('returns the newest complete code scan per requested repo', () => {
    const scans = [
      scan({ repo: 'o/app', completedAt: '2026-11-01T10:00:00Z', stats: { critical: 2, warning: 0, info: 0, resolved: 0, score: 70 } }),
      scan({ repo: 'o/app', completedAt: '2026-11-02T10:00:00Z', stats: { critical: 0, warning: 1, info: 2, resolved: 0, score: 97 } }),
      scan({ repo: 'o/app', completedAt: '2026-11-03T10:00:00Z', status: 'failed' }),
      scan({ repo: 'o/app', completedAt: '2026-11-04T10:00:00Z', module: 'cloud' }),
      scan({ repo: 'o/other', completedAt: '2026-11-01T09:00:00Z' }),
    ];
    const out = latestForgeScans(scans, ['o/app'], ORIGIN);
    assert.equal(out.length, 1);
    assert.deepEqual(
      { repo: out[0].repo, score: out[0].score, critical: out[0].critical, warning: out[0].warning, info: out[0].info },
      { repo: 'o/app', score: 97, critical: 0, warning: 1, info: 2 }
    );
    assert.equal(out[0].scannedAt, '2026-11-02T10:00:00Z');
    assert.equal(out[0].sha, 'a'.repeat(40));
  });

  it('omits repos that were never scanned and ignores same-named GitHub scans', () => {
    const gh = scan({ repo: 'o/app', provider: 'github', completedAt: '2026-11-09T00:00:00Z', stats: { critical: 9, warning: 0, info: 0, resolved: 0, score: 10 } });
    const fj = scan({ repo: 'o/app', completedAt: '2026-11-01T00:00:00Z' });
    const out = latestForgeScans([gh, fj], ['o/app', 'o/never-scanned'], ORIGIN);
    assert.deepEqual(out.map((r) => [r.repo, r.score]), [['o/app', 100]]);
  });

  it('returns nothing when nothing was requested', () => {
    assert.deepEqual(latestForgeScans([scan({ repo: 'o/app' })], [], ORIGIN), []);
  });
});
