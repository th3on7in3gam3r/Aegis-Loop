import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ProtectEvent, ProtectRule } from '../../types.js';
import { config } from '../../config.js';
import { dbConfigured, loadBlob, saveBlob } from '../../db.js';
import { listScans } from '../../store.js';
import { BUILTIN_RULES, findingToRule } from './rules.js';

const DATA_DIR = config.dataDir;
const RULES_FILE = join(DATA_DIR, 'protect-rules.json');
const EVENTS_FILE = join(DATA_DIR, 'protect-events.json');

let rules: ProtectRule[] = [];
let events: ProtectEvent[] = [];

function persistRules(): void {
  if (dbConfigured()) {
    saveBlob('protect-rules', rules);
    return;
  }
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2));
  } catch {
    /* keep in memory */
  }
}

function persistEvents(): void {
  const trimmed = events.slice(0, 200);
  events = trimmed;
  if (dbConfigured()) {
    saveBlob('protect-events', trimmed);
    return;
  }
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(EVENTS_FILE, JSON.stringify(trimmed, null, 2));
  } catch {
    /* keep in memory */
  }
}

export async function loadProtectStore(): Promise<void> {
  if (dbConfigured()) {
    rules = (await loadBlob<ProtectRule[]>('protect-rules')) ?? [...BUILTIN_RULES];
    events = (await loadBlob<ProtectEvent[]>('protect-events')) ?? [];
    return;
  }
  if (existsSync(RULES_FILE)) {
    try {
      rules = JSON.parse(readFileSync(RULES_FILE, 'utf8')) as ProtectRule[];
    } catch {
      rules = [...BUILTIN_RULES];
    }
  } else {
    rules = [...BUILTIN_RULES];
  }

  if (existsSync(EVENTS_FILE)) {
    try {
      events = JSON.parse(readFileSync(EVENTS_FILE, 'utf8')) as ProtectEvent[];
    } catch {
      events = [];
    }
  }
}

export function listProtectRules(): ProtectRule[] {
  return [...rules].sort((a, b) => a.title.localeCompare(b.title));
}

export function listProtectEvents(limit = 50): ProtectEvent[] {
  return events.slice(0, limit);
}

export function setProtectRuleEnabled(id: string, enabled: boolean): ProtectRule | undefined {
  const rule = rules.find((r) => r.id === id);
  if (!rule) return undefined;
  rule.enabled = enabled;
  persistRules();
  return rule;
}

export function syncProtectRulesFromScans(): ProtectRule[] {
  const existing = new Map(rules.map((r) => [r.id, r]));
  const merged: ProtectRule[] = [...BUILTIN_RULES.map((b) => existing.get(b.id) ?? { ...b })];

  for (const scan of listScans()) {
    if (scan.status !== 'complete') continue;
    for (const finding of scan.findings) {
      if (finding.fixed) continue;
      const draft = findingToRule(finding, scan.module ?? 'code');
      if (!draft) continue;
      const prev = existing.get(draft.id);
      merged.push({
        ...draft,
        enabled: prev?.enabled ?? true,
        blocked: prev?.blocked ?? 0,
      });
    }
  }

  const deduped = new Map<string, ProtectRule>();
  for (const rule of merged) deduped.set(rule.id, rule);
  rules = [...deduped.values()];
  persistRules();
  return listProtectRules();
}

export function evaluateProtectRequest(
  method: string,
  path: string,
  query: string,
  body: string
): ProtectEvent | null {
  const haystack = `${path}?${query}\n${body}`.slice(0, 8192);
  for (const rule of rules) {
    if (!rule.enabled) continue;
    try {
      const re = new RegExp(rule.pattern, 'i');
      if (!re.test(haystack)) continue;
      rule.blocked += 1;
      const event: ProtectEvent = {
        id: randomUUID(),
        ruleId: rule.id,
        path,
        method,
        blockedAt: new Date().toISOString(),
        detail: rule.title,
      };
      events.unshift(event);
      persistRules();
      persistEvents();
      return event;
    } catch {
      continue;
    }
  }
  return null;
}

export function protectStats(): { rules: number; enabled: number; blocked: number; events: number } {
  return {
    rules: rules.length,
    enabled: rules.filter((r) => r.enabled).length,
    blocked: rules.reduce((n, r) => n + r.blocked, 0),
    events: events.length,
  };
}
