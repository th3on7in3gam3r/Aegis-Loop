import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseAttackTargets } from './scanner.js';

describe('parseAttackTargets', () => {
  it('splits newline and comma separated URLs', () => {
    const targets = parseAttackTargets('https://a.com\nhttps://b.com, https://c.com');
    assert.deepEqual(targets, ['https://a.com', 'https://b.com', 'https://c.com']);
  });

  it('dedupes case-insensitively', () => {
    const targets = parseAttackTargets(['HTTPS://Example.com', 'https://example.com']);
    assert.equal(targets.length, 1);
  });

  it('caps at 20 targets', () => {
    const many = Array.from({ length: 25 }, (_, i) => `https://site${i}.test`);
    assert.equal(parseAttackTargets(many).length, 20);
  });

  it('throws when empty after parse', () => {
    assert.deepEqual(parseAttackTargets('  \n  '), []);
  });
});
