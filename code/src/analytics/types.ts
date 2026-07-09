export type AnalyticsEventType = 'pageview' | 'click' | 'scroll' | 'conversion';

export type ConversionKind = 'signup' | 'login' | 'checkout_intent' | 'contact' | 'pricing_click';

export interface AnalyticsEvent {
  id: string;
  ts: string;
  type: AnalyticsEventType;
  visitorId: string;
  sessionId: string;
  path: string;
  referrer?: string;
  channel: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  element?: string;
  label?: string;
  x?: number;
  y?: number;
  scrollDepth?: number;
  conversion?: ConversionKind;
  viewportW?: number;
  viewportH?: number;
}

export interface DailyVisitors {
  date: string;
  visitors: number;
  pageviews: number;
  sessions: number;
}

export interface ChannelStat {
  channel: string;
  visitors: number;
  pageviews: number;
  share: number;
}

export interface ClickStat {
  label: string;
  element: string;
  path: string;
  clicks: number;
}

export interface ConversionStat {
  kind: ConversionKind;
  count: number;
  rate: number;
}

export interface HeatmapCell {
  x: number;
  y: number;
  count: number;
}

export interface PageEngagement {
  path: string;
  pageviews: number;
  avgScroll: number;
  clicks: number;
  grade: string;
}

export interface AnalyticsInsight {
  id: string;
  severity: 'info' | 'warning' | 'opportunity';
  title: string;
  detail: string;
}

export interface AnalyticsSummary {
  days: number;
  visitors: number;
  pageviews: number;
  sessions: number;
  avgPagesPerSession: number;
  engagementChange: number;
  visitorsByDay: DailyVisitors[];
  channels: ChannelStat[];
  conversions: ConversionStat[];
  topClicks: ClickStat[];
  heatmap: HeatmapCell[];
  heatmapPath: string;
  pages: PageEngagement[];
  insights: AnalyticsInsight[];
  siteGrade: string;
  generatedAt: string;
}
