import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canScanRepo } from './limits.js';
import { getAccount, loadAccountStore } from './store.js';
import { saveScan } from '../store.js';
import type { ScanResult } from '../src/types.js';

function mockScan(repo: string, login: string): ScanResult {
  return {
    id: `scan-${repo}-${login}`,
    module: 'code',
    userLogin: login,
    repo,
    branch: 'main',
    status: 'complete',
    startedAt: new Date().toISOString(),
    findings: [],
    stats: { critical: 0, warning: 0, info: 0, resolved: 0, score: 100 },
  };
}

describe('billing limits', () => {
  it('allows rescanning an existing repo on free plan', () => {
    loadAccountStore();
    const account = getAccount('alice');
    saveScan(mockScan('acme/one', 'alice'));
    saveScan(mockScan('acme/two', 'alice'));
    saveScan(mockScan('acme/three', 'alice'));
    assert.equal(canScanRepo(account, 'acme/one').ok, true);
  });

  it('blocks a fourth new repo on free plan', () => {
    const account = getAccount('bob');
    saveScan(mockScan('acme/a', 'bob'));
    saveScan(mockScan('acme/b', 'bob'));
    saveScan(mockScan('acme/c', 'bob'));
    const blocked = canScanRepo(account, 'acme/d');
    assert.equal(blocked.ok, false);
  });

  it('does not count demo repos toward limits', () => {
    const account = getAccount('carol');
    saveScan(mockScan('aegis-loop/sample-app', 'carol'));
    assert.equal(canScanRepo(account, 'acme/new').ok, true);
  });
});
