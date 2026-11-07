import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decryptSecret, encryptSecret } from './secrets.js';

describe('secrets', () => {
  it('round-trips and never stores plaintext', () => {
    const enc = encryptSecret('gho_secret_token');
    assert.match(enc, /^enc:v1:/);
    assert.equal(enc.includes('gho_secret_token'), false);
    assert.equal(decryptSecret(enc), 'gho_secret_token');
    assert.notEqual(encryptSecret('gho_secret_token'), enc, 'random IV per value');
  });

  it('passes legacy plaintext through and rejects tampering', () => {
    assert.equal(decryptSecret('legacy-token'), 'legacy-token');
    const enc = encryptSecret('abc');
    const tampered = enc.slice(0, -2) + (enc.endsWith('A') ? 'B' : 'A') + enc.slice(-1);
    assert.throws(() => decryptSecret(tampered));
  });
});
