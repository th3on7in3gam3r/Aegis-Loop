import { llmConfigured } from '../config.js';
import type { AnalyticsInsight, AnalyticsSummary } from './types.js';

export function buildRuleInsights(summary: AnalyticsSummary): AnalyticsInsight[] {
  const insights: AnalyticsInsight[] = [];
  let n = 0;

  const push = (
    severity: AnalyticsInsight['severity'],
    title: string,
    detail: string,
  ) => {
    insights.push({ id: `insight-${++n}`, severity, title, detail });
  };

  if (summary.visitors === 0) {
    push(
      'info',
      'No visitor data yet',
      'Analytics will populate after visitors accept cookies on your marketing site. Share the homepage or run a test visit with “Accept all” on the cookie banner.',
    );
    return insights;
  }

  if (summary.engagementChange > 15) {
    push(
      'opportunity',
      `Visitor traffic up ${summary.engagementChange}%`,
      'Engagement is rising versus the prior period. Double down on the channels and pages driving the lift.',
    );
  } else if (summary.engagementChange < -15) {
    push(
      'warning',
      `Visitor traffic down ${Math.abs(summary.engagementChange)}%`,
      'Fewer unique visitors than the previous period. Review campaigns, SEO snippets, and top landing pages.',
    );
  }

  const topChannel = summary.channels[0];
  if (topChannel && topChannel.share >= 60) {
    push(
      'info',
      `${topChannel.channel} drives ${topChannel.share}% of visitors`,
      'Traffic is concentrated in one channel. Add UTM tags to campaigns so secondary sources are easier to compare.',
    );
  }

  const pricingClicks =
    summary.topClicks.find((c) => /pricing|team|upgrade|start for free/i.test(c.label))?.clicks ?? 0;
  if (summary.pageviews >= 20 && pricingClicks === 0) {
    push(
      'warning',
      'Pricing CTAs are under-clicked',
      'Visitors are browsing but not hitting upgrade or pricing buttons. Test CTA placement above the fold on high-traffic pages.',
    );
  }

  const home = summary.pages.find((p) => p.path === '/' || p.path === '/index.html');
  if (home && home.avgScroll < 45 && home.pageviews >= 10) {
    push(
      'warning',
      'Homepage scroll depth is shallow',
      `Average scroll on ${home.path} is ${home.avgScroll}%. Move social proof or the primary CTA higher so visitors see value sooner.`,
    );
  }

  const signup = summary.conversions.find((c) => c.kind === 'signup');
  if (signup && signup.count > 0 && signup.rate < 2 && summary.visitors >= 25) {
    push(
      'opportunity',
      'Signups are happening but conversion is low',
      `${signup.count} signups from ${summary.visitors} visitors (${signup.rate}%). Tighten the login CTA on high-traffic sections.`,
    );
  } else if (signup && signup.count === 0 && summary.visitors >= 15) {
    push(
      'warning',
      'No signups recorded yet',
      'Visitors are arriving but not creating accounts. Make the GitHub login path obvious from hero and pricing.',
    );
  }

  const weakPage = summary.pages.find((p) => p.grade === 'D' || p.grade === 'F');
  if (weakPage) {
    push(
      'warning',
      `Page grade ${weakPage.grade} on ${weakPage.path}`,
      'Low scroll depth or weak CTA engagement on this page. Review layout, headline clarity, and button contrast.',
    );
  }

  const strongPage = summary.pages.find((p) => p.grade === 'A');
  if (strongPage) {
    push(
      'opportunity',
      `High-performing page: ${strongPage.path}`,
      `Grade A with ${strongPage.avgScroll}% average scroll. Reuse this layout pattern on weaker landing sections.`,
    );
  }

  if (summary.avgPagesPerSession < 1.3 && summary.sessions >= 10) {
    push(
      'warning',
      'Most sessions are single-page',
      'Visitors rarely view a second page. Add clearer next-step links from hero to modules, pricing, and docs.',
    );
  }

  return insights.slice(0, 8);
}

export async function enrichInsightsWithAi(
  summary: AnalyticsSummary,
  insights: AnalyticsInsight[],
): Promise<AnalyticsInsight[]> {
  if (!llmConfigured() || summary.visitors < 5) return insights;

  try {
    const { generateAnalyticsInsights } = await import('../ai/analyticsInsights.js');
    const aiInsights = await generateAnalyticsInsights(summary);
    const merged = [...insights];
    for (const item of aiInsights) {
      if (!merged.some((m) => m.title === item.title)) merged.push(item);
    }
    return merged.slice(0, 10);
  } catch {
    return insights;
  }
}
