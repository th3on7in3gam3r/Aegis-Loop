import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { dbConfigured, loadBlob, saveBlob } from '../db.js';
import { classifyChannel } from './channels.js';
import type { AnalyticsEvent, ConversionKind } from './types.js';

const STORE_FILE = join(config.dataDir, 'analytics-events.json');
const BLOB_NAME = 'analytics-events';
const MAX_EVENTS = 8000;

const events: AnalyticsEvent[] = [];

function persist(): void {
  if (dbConfigured()) {
    saveBlob(BLOB_NAME, events);
    return;
  }
  try {
    mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(STORE_FILE, JSON.stringify(events, null, 2));
  } catch {
    /* disk issue — keep in-memory */
  }
}

export async function loadAnalyticsStore(): Promise<void> {
  if (dbConfigured()) {
    const data = await loadBlob<AnalyticsEvent[]>(BLOB_NAME);
    if (data) events.push(...data.slice(-MAX_EVENTS));
    return;
  }
  if (!existsSync(STORE_FILE)) return;
  try {
    const data = JSON.parse(readFileSync(STORE_FILE, 'utf8')) as AnalyticsEvent[];
    events.push(...data.slice(-MAX_EVENTS));
  } catch {
    /* corrupt — start fresh */
  }
}

export function listAnalyticsEvents(): AnalyticsEvent[] {
  return [...events];
}

export function ingestAnalyticsEvents(raw: unknown[]): AnalyticsEvent[] {
  const accepted: AnalyticsEvent[] = [];

  for (const item of raw) {
    const event = normalizeEvent(item);
    if (!event) continue;
    events.push(event);
    accepted.push(event);
  }

  while (events.length > MAX_EVENTS) events.shift();
  if (accepted.length) persist();
  return accepted;
}

export function recordServerConversion(
  kind: ConversionKind,
  input: { visitorId?: string; sessionId?: string; path?: string; githubLogin?: string },
): void {
  const event: AnalyticsEvent = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    type: 'conversion',
    visitorId: input.visitorId ?? `server:${input.githubLogin ?? 'unknown'}`,
    sessionId: input.sessionId ?? `server:${randomUUID()}`,
    path: input.path ?? '/app/',
    channel: 'Direct',
    conversion: kind,
  };
  events.push(event);
  while (events.length > MAX_EVENTS) events.shift();
  persist();
}

function normalizeEvent(item: unknown): AnalyticsEvent | null {
  if (!item || typeof item !== 'object') return null;
  const raw = item as Record<string, unknown>;
  const type = raw.type;
  if (type !== 'pageview' && type !== 'click' && type !== 'scroll' && type !== 'conversion') {
    return null;
  }

  const visitorId = asString(raw.visitorId, 64);
  const sessionId = asString(raw.sessionId, 64);
  const path = asString(raw.path, 256) || '/';
  if (!visitorId || !sessionId) return null;

  const referrer = asString(raw.referrer, 512) || undefined;
  const utmSource = asString(raw.utmSource, 120) || undefined;
  const utmMedium = asString(raw.utmMedium, 120) || undefined;
  const utmCampaign = asString(raw.utmCampaign, 120) || undefined;

  const event: AnalyticsEvent = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    type,
    visitorId,
    sessionId,
    path: path.startsWith('/') ? path : `/${path}`,
    referrer,
    channel: classifyChannel(referrer, {
      source: utmSource,
      medium: utmMedium,
      campaign: utmCampaign,
    }),
    utmSource,
    utmMedium,
    utmCampaign,
  };

  if (type === 'click') {
    event.element = asString(raw.element, 200) || undefined;
    event.label = asString(raw.label, 200) || undefined;
    event.x = clampNum(raw.x, 0, 100);
    event.y = clampNum(raw.y, 0, 100);
    event.viewportW = clampNum(raw.viewportW, 0, 10000);
    event.viewportH = clampNum(raw.viewportH, 0, 10000);
  }

  if (type === 'scroll') {
    event.scrollDepth = clampNum(raw.scrollDepth, 0, 100);
  }

  if (type === 'conversion') {
    const conversion = raw.conversion;
    if (
      conversion !== 'signup' &&
      conversion !== 'login' &&
      conversion !== 'checkout_intent' &&
      conversion !== 'contact' &&
      conversion !== 'pricing_click'
    ) {
      return null;
    }
    event.conversion = conversion;
  }

  return event;
}

function asString(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function clampNum(value: unknown, min: number, max: number): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, n));
}
