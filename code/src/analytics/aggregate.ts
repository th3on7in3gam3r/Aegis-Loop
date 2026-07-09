import type {
  AnalyticsEvent,
  AnalyticsSummary,
  ChannelStat,
  ClickStat,
  ConversionStat,
  DailyVisitors,
  HeatmapCell,
  PageEngagement,
} from './types.js';

const GRID = 20;

export function buildAnalyticsSummary(events: AnalyticsEvent[], days = 7): AnalyticsSummary {
  const now = Date.now();
  const windowMs = days * 24 * 60 * 60 * 1000;
  const prevWindowMs = windowMs * 2;
  const current = events.filter((e) => now - Date.parse(e.ts) <= windowMs);
  const previous = events.filter((e) => {
    const age = now - Date.parse(e.ts);
    return age > windowMs && age <= prevWindowMs;
  });

  const visitors = uniqueVisitors(current);
  const prevVisitors = uniqueVisitors(previous);
  const pageviews = current.filter((e) => e.type === 'pageview').length;
  const sessions = uniqueSessions(current);
  const avgPagesPerSession = sessions ? pageviews / sessions : 0;
  const engagementChange =
    prevVisitors > 0 ? Math.round(((visitors - prevVisitors) / prevVisitors) * 100) : visitors > 0 ? 100 : 0;

  const visitorsByDay = buildDailyVisitors(current, days);
  const channels = buildChannels(current, visitors);
  const conversions = buildConversions(current, visitors);
  const topClicks = buildTopClicks(current);
  const heatmapPath = pickHeatmapPath(current);
  const heatmap = buildHeatmap(current.filter((e) => e.type === 'click' && e.path === heatmapPath));
  const pages = buildPageEngagement(current);
  const siteGrade = gradeSite(pages, conversions, avgPagesPerSession);

  return {
    days,
    visitors,
    pageviews,
    sessions,
    avgPagesPerSession: round(avgPagesPerSession, 1),
    engagementChange,
    visitorsByDay,
    channels,
    conversions,
    topClicks,
    heatmap,
    heatmapPath,
    pages,
    insights: [],
    siteGrade,
    generatedAt: new Date().toISOString(),
  };
}

function uniqueVisitors(list: AnalyticsEvent[]): number {
  return new Set(list.map((e) => e.visitorId)).size;
}

function uniqueSessions(list: AnalyticsEvent[]): number {
  return new Set(list.map((e) => e.sessionId)).size;
}

function buildDailyVisitors(events: AnalyticsEvent[], days: number): DailyVisitors[] {
  const buckets = new Map<string, { visitors: Set<string>; pageviews: number; sessions: Set<string> }>();

  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    buckets.set(d.toISOString().slice(0, 10), { visitors: new Set(), pageviews: 0, sessions: new Set() });
  }

  for (const event of events) {
    const date = event.ts.slice(0, 10);
    const bucket = buckets.get(date);
    if (!bucket) continue;
    bucket.visitors.add(event.visitorId);
    bucket.sessions.add(event.sessionId);
    if (event.type === 'pageview') bucket.pageviews += 1;
  }

  return [...buckets.entries()].map(([date, b]) => ({
    date,
    visitors: b.visitors.size,
    pageviews: b.pageviews,
    sessions: b.sessions.size,
  }));
}

function buildChannels(events: AnalyticsEvent[], visitors: number): ChannelStat[] {
  const map = new Map<string, { visitors: Set<string>; pageviews: number }>();
  for (const event of events) {
    const row = map.get(event.channel) ?? { visitors: new Set(), pageviews: 0 };
    row.visitors.add(event.visitorId);
    if (event.type === 'pageview') row.pageviews += 1;
    map.set(event.channel, row);
  }

  return [...map.entries()]
    .map(([channel, row]) => ({
      channel,
      visitors: row.visitors.size,
      pageviews: row.pageviews,
      share: visitors ? Math.round((row.visitors.size / visitors) * 100) : 0,
    }))
    .sort((a, b) => b.visitors - a.visitors);
}

function buildConversions(events: AnalyticsEvent[], visitors: number): ConversionStat[] {
  const kinds = ['signup', 'login', 'checkout_intent', 'contact', 'pricing_click'] as const;
  const counts = new Map<string, number>();
  for (const kind of kinds) counts.set(kind, 0);

  for (const event of events) {
    if (event.type === 'conversion' && event.conversion) {
      counts.set(event.conversion, (counts.get(event.conversion) ?? 0) + 1);
    }
  }

  return kinds.map((kind) => {
    const count = counts.get(kind) ?? 0;
    return {
      kind,
      count,
      rate: visitors ? round((count / visitors) * 100, 1) : 0,
    };
  });
}

function buildTopClicks(events: AnalyticsEvent[]): ClickStat[] {
  const map = new Map<string, ClickStat>();
  for (const event of events) {
    if (event.type !== 'click') continue;
    const label = event.label || event.element || 'Unknown';
    const key = `${event.path}|${label}`;
    const row = map.get(key) ?? { label, element: event.element ?? '', path: event.path, clicks: 0 };
    row.clicks += 1;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.clicks - a.clicks).slice(0, 12);
}

function pickHeatmapPath(events: AnalyticsEvent[]): string {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (event.type !== 'click') continue;
    counts.set(event.path, (counts.get(event.path) ?? 0) + 1);
  }
  if (!counts.size) return '/';
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function buildHeatmap(clicks: AnalyticsEvent[]): HeatmapCell[] {
  const grid = new Map<string, number>();
  for (const event of clicks) {
    if (event.x == null || event.y == null) continue;
    const x = Math.min(GRID - 1, Math.floor((event.x / 100) * GRID));
    const y = Math.min(GRID - 1, Math.floor((event.y / 100) * GRID));
    const key = `${x},${y}`;
    grid.set(key, (grid.get(key) ?? 0) + 1);
  }
  return [...grid.entries()].map(([key, count]) => {
    const [x, y] = key.split(',').map(Number);
    return { x, y, count };
  });
}

function buildPageEngagement(events: AnalyticsEvent[]): PageEngagement[] {
  const map = new Map<string, { pageviews: number; scrolls: number[]; clicks: number }>();
  for (const event of events) {
    const row = map.get(event.path) ?? { pageviews: 0, scrolls: [], clicks: 0 };
    if (event.type === 'pageview') row.pageviews += 1;
    if (event.type === 'scroll' && event.scrollDepth != null) row.scrolls.push(event.scrollDepth);
    if (event.type === 'click') row.clicks += 1;
    map.set(event.path, row);
  }

  return [...map.entries()]
    .map(([path, row]) => {
      const avgScroll = row.scrolls.length
        ? Math.round(row.scrolls.reduce((a, b) => a + b, 0) / row.scrolls.length)
        : 0;
      const clickRate = row.pageviews ? row.clicks / row.pageviews : 0;
      const grade = gradePage(avgScroll, clickRate, row.pageviews);
      return { path, pageviews: row.pageviews, avgScroll, clicks: row.clicks, grade };
    })
    .sort((a, b) => b.pageviews - a.pageviews)
    .slice(0, 10);
}

function gradePage(avgScroll: number, clickRate: number, pageviews: number): string {
  if (pageviews < 3) return '—';
  const score = avgScroll * 0.45 + Math.min(clickRate * 100, 40) * 0.55;
  if (score >= 75) return 'A';
  if (score >= 60) return 'B';
  if (score >= 45) return 'C';
  if (score >= 30) return 'D';
  return 'F';
}

function gradeSite(
  pages: PageEngagement[],
  conversions: ConversionStat[],
  avgPagesPerSession: number,
): string {
  const graded = pages.filter((p) => p.grade !== '—');
  const avgPageScore =
    graded.length > 0
      ? graded.reduce((sum, p) => sum + letterScore(p.grade), 0) / graded.length
      : 50;
  const signupRate = conversions.find((c) => c.kind === 'signup')?.rate ?? 0;
  const score = avgPageScore * 0.55 + Math.min(avgPagesPerSession * 15, 25) + Math.min(signupRate * 4, 20);
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  if (score >= 35) return 'D';
  return 'F';
}

function letterScore(grade: string): number {
  return ({ A: 95, B: 80, C: 65, D: 50, F: 30 } as Record<string, number>)[grade] ?? 50;
}

function round(n: number, digits: number): number {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}
