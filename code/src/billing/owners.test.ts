import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ownerPlanForLogin, isOwnerLogin, syncOwnerPlan } from './owners.js';
import { loadAccountStore } from './store.js';

describe('billing owners', () => {
  const env = { ...process.env };

  beforeEach(() => {
    delete process.env.AEGIS_OWNER_LOGINS;
    delete process.env.AEGIS_OWNER_PLAN;
    loadAccountStore();
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it('returns null when allowlist is unset', () => {
    assert.equal(ownerPlanForLogin('alice'), null);
  });

  it('grants enterprise to allowlisted login', () => {
    process.env.AEGIS_OWNER_LOGINS = 'Alice, bob';
    process.env.AEGIS_OWNER_PLAN = 'enterprise';
    assert.equal(ownerPlanForLogin('alice'), 'enterprise');
    assert.equal(isOwnerLogin('bob'), true);
    assert.equal(isOwnerLogin('carol'), false);
  });

  it('syncOwnerPlan upgrades account on server', () => {
    process.env.AEGIS_OWNER_LOGINS = 'founder';
    process.env.AEGIS_OWNER_PLAN = 'team';
    const account = syncOwnerPlan('founder');
    assert.equal(account.plan, 'team');
    assert.equal(account.seats, 3);
  });
});
