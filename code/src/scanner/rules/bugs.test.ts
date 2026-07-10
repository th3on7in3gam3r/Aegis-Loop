import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { bugsRule } from './bugs.js';
import { attachRemediation } from '../../modules/remediation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '../../../fixtures/sample-repo');

function walkFiles(root: string, dir = root, prefix = ''): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const rel = prefix ? `${prefix}/${entry}` : entry;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walkFiles(root, full, rel));
    else files.push(rel);
  }
  return files;
}

describe('bugsRule', () => {
  it('finds demo bug patterns in sample-repo with remediation', () => {
    const files = walkFiles(FIXTURE);
    const drafts = bugsRule.run({
      scanId: 'test',
      rootDir: FIXTURE,
      listFiles: () => files,
      readFile: (rel) => {
        try {
          return readFileSync(join(FIXTURE, rel), 'utf8');
        } catch {
          return null;
        }
      },
    });

    const ruleIds = new Set(drafts.map((d) => d.ruleId));
    assert.ok(ruleIds.has('bug/loose-equality'));
    assert.ok(ruleIds.has('bug/parseint-no-radix'));
    assert.ok(ruleIds.has('bug/foreach-async'));
    assert.ok(ruleIds.has('bug/empty-catch'));
    assert.ok(ruleIds.has('bug/throw-literal'));

    for (const draft of drafts) {
      const f = attachRemediation(draft);
      assert.ok(f.remediation, `missing remediation for ${f.ruleId}`);
      assert.ok(f.message.length > 10);
    }
  });
});
