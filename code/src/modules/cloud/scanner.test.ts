import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { scanCloudDirectory } from './scanner.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/cloud-demo');

describe('scanCloudDirectory', () => {
  it('finds misconfigs in cloud-demo fixture', async () => {
    const scan = await scanCloudDirectory(FIXTURE, 'aegis-loop/cloud-demo', 'main');
    assert.equal(scan.status, 'complete');
    assert.equal(scan.module, 'cloud');
    assert.ok(scan.findings.length > 0, 'expected at least one finding');
    assert.ok(scan.findings.every((f) => f.remediation?.steps?.length));
    assert.ok(scan.stats.critical + scan.stats.warning > 0);
  });
});
