import { randomUUID } from 'node:crypto';
import type { Finding, ScanResult } from '../../types.js';
import { attachRemediation } from '../remediation.js';
import { calcStats } from '../stats.js';

const FETCH_TIMEOUT_MS = 12_000;
const USER_AGENT = 'AegisLoop-Attack/1.0 (+https://aegisloop.dev)';

interface HeaderCheck {
  id: string;
  title: string;
  severity: Finding['severity'];
  header: string;
  message: string;
}

const HEADER_CHECKS: HeaderCheck[] = [
  {
    id: 'attack/missing-hsts',
    title: 'Missing Strict-Transport-Security',
    severity: 'warning',
    header: 'strict-transport-security',
    message: 'HSTS header not set — browsers may connect over plaintext HTTP.',
  },
  {
    id: 'attack/missing-csp',
    title: 'Missing Content-Security-Policy',
    severity: 'warning',
    header: 'content-security-policy',
    message: 'No CSP header — XSS impact is harder to contain in the browser.',
  },
  {
    id: 'attack/missing-xfo',
    title: 'Missing X-Frame-Options',
    severity: 'info',
    header: 'x-frame-options',
    message: 'Clickjacking protection header not present.',
  },
  {
    id: 'attack/missing-xcto',
    title: 'Missing X-Content-Type-Options',
    severity: 'info',
    header: 'x-content-type-options',
    message: 'nosniff header not set — MIME confusion attacks are easier.',
  },
];

function normalizeTarget(input: string): URL {
  const trimmed = input.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only http and https targets are supported');
  }
  return url;
}

async function fetchTarget(url: URL): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { Accept: 'text/html,*/*', 'User-Agent': USER_AGENT },
    });
  } finally {
    clearTimeout(timer);
  }
}

function pushFinding(findings: Finding[], scanId: string, draft: Omit<Finding, 'id' | 'scanId' | 'fixed' | 'remediation'>) {
  findings.push(
    attachRemediation({
      ...draft,
      id: randomUUID(),
      scanId,
      fixed: false,
    })
  );
}

export async function scanAttackTarget(targetInput: string): Promise<ScanResult> {
  const scanId = randomUUID();
  const startedAt = new Date().toISOString();
  const url = normalizeTarget(targetInput);
  const findings: Finding[] = [];

  try {
    const res = await fetchTarget(url);
    const headers = res.headers;

    if (url.protocol === 'http:') {
      pushFinding(findings, scanId, {
        severity: 'critical',
        ruleId: 'attack/plain-http',
        title: 'Site served over HTTP',
        file: url.hostname,
        line: 0,
        message: 'Target responds over unencrypted HTTP — enforce HTTPS redirects.',
        snippet: `GET ${url.toString()} → ${res.status}`,
      });
    }

    for (const check of HEADER_CHECKS) {
      if (headers.get(check.header)) continue;
      pushFinding(findings, scanId, {
        severity: check.severity,
        ruleId: check.id,
        title: check.title,
        file: url.hostname,
        line: 0,
        message: check.message,
        snippet: `Checked response headers from ${url.origin}`,
      });
    }

    const server = headers.get('server');
    if (server && /apache|nginx|iis|php/i.test(server)) {
      pushFinding(findings, scanId, {
        severity: 'info',
        ruleId: 'attack/server-disclosure',
        title: 'Server header disclosure',
        file: url.hostname,
        line: 0,
        message: `Server header reveals stack info: ${server}`,
        snippet: `Server: ${server}`,
      });
    }

    if (res.status >= 500) {
      pushFinding(findings, scanId, {
        severity: 'warning',
        ruleId: 'attack/error-leak',
        title: 'Server error response',
        file: url.hostname,
        line: 0,
        message: `HTTP ${res.status} — may indicate misconfiguration or verbose error pages.`,
        snippet: `GET ${url.pathname} → ${res.status}`,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Probe failed';
    return {
      id: scanId,
      module: 'attack',
      repo: url.hostname,
      branch: 'surface',
      target: url.toString(),
      status: 'failed',
      error: message,
      startedAt,
      completedAt: new Date().toISOString(),
      findings: [],
      stats: calcStats([]),
    };
  }

  const completedAt = new Date().toISOString();
  return {
    id: scanId,
    module: 'attack',
    repo: url.hostname,
    branch: 'surface',
    target: url.toString(),
    status: 'complete',
    startedAt,
    completedAt,
    findings,
    stats: calcStats(findings),
  };
}

export function parseAttackTargets(input: string | string[]): string[] {
  const raw = Array.isArray(input) ? input : input.split(/[\n,]+/);
  const seen = new Set<string>();
  const targets: string[] = [];
  for (const item of raw) {
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    targets.push(trimmed);
  }
  return targets.slice(0, 20);
}

export async function scanAttackTargets(input: string | string[]): Promise<ScanResult[]> {
  const targets = parseAttackTargets(input);
  if (!targets.length) {
    throw new Error('At least one target URL is required');
  }
  const scans: ScanResult[] = [];
  for (const target of targets) {
    scans.push(await scanAttackTarget(target));
  }
  return scans;
}
