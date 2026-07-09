import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyChannel } from './channels.js';
import { buildAnalyticsSummary } from './aggregate.js';
import type { AnalyticsEvent } from './types.js';

describe('analytics channels', () => {
  it('classifies direct traffic', () => {
    assert.equal(classifyChannel(undefined, {}), 'Direct');
  });

  it('classifies organic search from referrer', () => {
    assert.equal(classifyChannel('https://www.google.com/search?q=aegis', {}), 'Organic Search');
  });

  it('classifies paid traffic from utm medium', () => {
    assert.equal(classifyChannel(undefined, { medium: 'cpc', source: 'google' }), 'Paid');
  });
});

describe('analytics aggregate', () => {
  it('summarizes visitors and conversions', () => {
    const now = new Date().toISOString();
    const events: AnalyticsEvent[] = [
      {
        id: '1',
        ts: now,
        type: 'pageview',
        visitorId: 'v1',
        sessionId: 's1',
        path: '/',
        channel: 'Direct',
      },
      {
        id: '2',
        ts: now,
        type: 'conversion',
        visitorId: 'v1',
        sessionId: 's1',
        path: '/login',
        channel: 'Direct',
        conversion: 'signup',
      },
      {
        id: '3',
        ts: now,
        type: 'click',
        visitorId: 'v2',
        sessionId: 's2',
        path: '/',
        channel: 'GitHub',
        label: 'Start for Free',
        x: 50,
        y: 40,
      },
    ];

    const summary = buildAnalyticsSummary(events, 7);
    assert.equal(summary.visitors, 2);
    assert.equal(summary.pageviews, 1);
    assert.equal(summary.conversions.find((c) => c.kind === 'signup')?.count, 1);
    assert.ok(summary.topClicks.length >= 1);
    assert.ok(summary.heatmap.length >= 1);
  });
});
