import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isAnthropicModelUnavailableError } from './llm.js';

describe('isAnthropicModelUnavailableError', () => {
  it('detects retired/invalid model responses', () => {
    assert.equal(isAnthropicModelUnavailableError(404, 'model: claude-sonnet-4-20250514'), true);
    assert.equal(
      isAnthropicModelUnavailableError(400, 'model: claude-sonnet-4-20250514'),
      true
    );
    assert.equal(
      isAnthropicModelUnavailableError(404, 'The model was not found'),
      true
    );
  });

  it('does not treat billing or auth failures as model fallback triggers', () => {
    assert.equal(isAnthropicModelUnavailableError(401, 'invalid x-api-key'), false);
    assert.equal(
      isAnthropicModelUnavailableError(400, 'Your credit balance is too low'),
      false
    );
    assert.equal(isAnthropicModelUnavailableError(429, 'rate_limit_error'), false);
  });
});
