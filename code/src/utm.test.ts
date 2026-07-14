import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withUtm } from './utm.js';

describe('withUtm', () => {
  it('appends source and campaign on a bare landing URL', () => {
    const out = withUtm('https://aegis-loop.com/', {
      source: 'cadence',
      campaign: 'spring-launch',
    });
    assert.equal(
      out,
      'https://aegis-loop.com/?utm_source=cadence&utm_campaign=spring-launch'
    );
  });

  it('preserves existing query params and adds optional medium/content', () => {
    const out = withUtm('https://aegis-loop.com/app/?scan=abc&view=findings', {
      source: 'aegis',
      campaign: 'scan-complete',
      medium: 'email',
      content: 'cta-primary',
    });
    const u = new URL(out);
    assert.equal(u.searchParams.get('scan'), 'abc');
    assert.equal(u.searchParams.get('view'), 'findings');
    assert.equal(u.searchParams.get('utm_source'), 'aegis');
    assert.equal(u.searchParams.get('utm_campaign'), 'scan-complete');
    assert.equal(u.searchParams.get('utm_medium'), 'email');
    assert.equal(u.searchParams.get('utm_content'), 'cta-primary');
  });

  it('does not overwrite existing utm params', () => {
    const out = withUtm(
      'https://aegis-loop.com/?utm_source=kerygma&utm_campaign=weekly-digest&ref=1',
      { source: 'cadence', campaign: 'url-check', medium: 'referral' }
    );
    const u = new URL(out);
    assert.equal(u.searchParams.get('utm_source'), 'kerygma');
    assert.equal(u.searchParams.get('utm_campaign'), 'weekly-digest');
    assert.equal(u.searchParams.get('ref'), '1');
    assert.equal(u.searchParams.get('utm_medium'), 'referral');
  });
});
