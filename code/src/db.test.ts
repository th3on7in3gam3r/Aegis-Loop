import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import { __setPoolForTests, dbConfigured, flushAll, loadBlob, saveBlob } from './db.js';

describe('db blob storage', () => {
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  __setPoolForTests(new Pool());

  after(() => __setPoolForTests(null));

  it('reports configured with injected pool', () => {
    assert.equal(dbConfigured(), true);
  });

  it('returns null for a missing blob', async () => {
    assert.equal(await loadBlob('nope'), null);
  });

  it('round-trips a blob', async () => {
    saveBlob('scans', [{ id: 'a', repo: 'x/y' }]);
    await flushAll();
    const data = await loadBlob<{ id: string; repo: string }[]>('scans');
    assert.deepEqual(data, [{ id: 'a', repo: 'x/y' }]);
  });

  it('coalesces rapid writes and keeps the last payload', async () => {
    saveBlob('accounts', [{ login: 'v1' }]);
    saveBlob('accounts', [{ login: 'v2' }]);
    saveBlob('accounts', [{ login: 'v3' }]);
    await flushAll();
    const data = await loadBlob<{ login: string }[]>('accounts');
    assert.deepEqual(data, [{ login: 'v3' }]);
  });
});
