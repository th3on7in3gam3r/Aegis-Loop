import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildScanCompleteEmail } from './templates/scan-complete.js';

describe('buildScanCompleteEmail', () => {
  it('renders branded scan complete HTML with score, findings, and CTAs', () => {
    const { html, text, subject } = buildScanCompleteEmail({
      scan: {
        id: 'scan-1',
        module: 'code',
        repo: 'acme/web-app',
        branch: 'main',
        stats: { critical: 2, warning: 3, info: 1, resolved: 0, score: 65 },
        findings: [],
      },
      topFindings: [
        'Hardcoded API key in config.ts',
        'SQL injection risk in user query',
      ],
      previousScore: 72,
    });

    assert.equal(subject, 'Code scan complete — acme/web-app scored 65/100');
    assert.match(html, /Security score/);
    assert.match(html, />65</);
    assert.match(html, /▼ -7/);
    assert.match(html, /2 critical/);
    assert.match(html, /Hardcoded API key/);
    assert.match(html, /Open scan results/);
    assert.match(html, /aegis-loop\.com/);
    assert.match(text, /Top findings:/);
    assert.match(text, /1\. Hardcoded API key/);
  });

  it('renders score drop variant with alert styling', () => {
    const { html, subject } = buildScanCompleteEmail({
      scan: {
        id: 'scan-2',
        module: 'cloud',
        repo: 'acme/infra',
        branch: 'main',
        stats: { critical: 4, warning: 1, info: 0, resolved: 0, score: 40 },
        findings: [],
      },
      topFindings: ['Public S3 bucket policy'],
      previousScore: 55,
      variant: 'score_drop',
    });

    assert.match(subject, /score dropped/);
    assert.match(html, /Score alert/);
    assert.match(html, /moved from/);
  });

  it('uses attack target in subject for attack probes', () => {
    const { subject } = buildScanCompleteEmail({
      scan: {
        id: 'scan-3',
        module: 'attack',
        repo: 'attack-probe',
        branch: 'main',
        target: 'https://api.example.com',
        stats: { critical: 0, warning: 2, info: 0, resolved: 0, score: 90 },
        findings: [],
      },
      topFindings: [],
    });

    assert.match(subject, /https:\/\/api\.example\.com/);
  });
});
