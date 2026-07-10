import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { remediationForRule, attachRemediation } from './remediation.js';

const CLOUD_RULES = [
  'cloud/s3-public-acl',
  'cloud/sg-open-world',
  'cloud/iam-wildcard',
  'cloud/k8s-public-lb',
  'cloud/docker-exposed-port',
  'cloud/gcp-public-bucket',
  'cloud/azure-open-nsg',
];

const ATTACK_RULES = [
  'attack/plain-http',
  'attack/missing-hsts',
  'attack/missing-csp',
  'attack/missing-xfo',
  'attack/missing-xcto',
  'attack/server-disclosure',
  'attack/error-leak',
];

const BUG_RULES = [
  'bug/empty-catch',
  'bug/loose-equality',
  'bug/parseint-no-radix',
  'bug/console-log',
  'bug/foreach-async',
  'bug/assignment-in-condition',
  'bug/throw-literal',
];

describe('remediation', () => {
  it('covers all cloud rule IDs', () => {
    for (const id of CLOUD_RULES) {
      const r = remediationForRule(id);
      assert.ok(r, `missing remediation for ${id}`);
      assert.ok(r!.summary.length > 10);
      assert.ok(r!.steps.length >= 2);
    }
  });

  it('covers all attack rule IDs', () => {
    for (const id of ATTACK_RULES) {
      const r = remediationForRule(id);
      assert.ok(r, `missing remediation for ${id}`);
      assert.ok(r!.steps.length >= 1);
    }
  });

  it('covers all bug rule IDs', () => {
    for (const id of BUG_RULES) {
      const r = remediationForRule(id);
      assert.ok(r, `missing remediation for ${id}`);
      assert.ok(r!.steps.length >= 2);
    }
  });

  it('attachRemediation adds steps to findings', () => {
    const finding = attachRemediation({
      ruleId: 'cloud/sg-open-world',
      title: 'test',
    });
    assert.ok(finding.remediation);
    assert.match(finding.remediation!.summary, /CIDR/i);
  });
});
