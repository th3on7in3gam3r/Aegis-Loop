import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { bugsRule, hasAssignmentInIfCondition } from './bugs.js';
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

describe('hasAssignmentInIfCondition', () => {
  it('flags real assignments in if conditions', () => {
    assert.equal(hasAssignmentInIfCondition('if (x = 1) {'), true);
    assert.equal(hasAssignmentInIfCondition('if ((flag = true)) {'), true);
    assert.equal(hasAssignmentInIfCondition('if (user = await getUser()) {'), true);
  });

  it('does not flag comparisons or arrows', () => {
    assert.equal(hasAssignmentInIfCondition('if (existing.length >= 5) {'), false);
    assert.equal(hasAssignmentInIfCondition('if (n <= 10) {'), false);
    assert.equal(hasAssignmentInIfCondition('if (a == b) {'), false);
    assert.equal(hasAssignmentInIfCondition('if (a === b) {'), false);
    assert.equal(hasAssignmentInIfCondition('if (a != b) {'), false);
    assert.equal(hasAssignmentInIfCondition('if (a !== b) {'), false);
    assert.equal(hasAssignmentInIfCondition('if (xs.some(x => x.id)) {'), false);
    assert.equal(hasAssignmentInIfCondition('if (ready) {'), false);
  });
});

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
    assert.ok(ruleIds.has('bug/assignment-in-condition'));

    const assignment = drafts.find((d) => d.ruleId === 'bug/assignment-in-condition');
    assert.ok(assignment?.snippet.includes('flag = true'));

    for (const draft of drafts) {
      const f = attachRemediation(draft);
      assert.ok(f.remediation, `missing remediation for ${f.ruleId}`);
      assert.ok(f.message.length > 10);
    }
  });
});
