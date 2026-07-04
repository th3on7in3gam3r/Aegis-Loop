import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScanResult } from './types.js';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '../data');
const STORE_FILE = join(DATA_DIR, 'scans.json');

const scans = new Map<string, ScanResult>();

function persist(): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STORE_FILE, JSON.stringify(listScans(), null, 2));
  } catch {
    /* disk full or permissions — keep in-memory store */
  }
}

export function loadStore(): void {
  if (!existsSync(STORE_FILE)) return;
  try {
    const data = JSON.parse(readFileSync(STORE_FILE, 'utf8')) as ScanResult[];
    for (const scan of data) scans.set(scan.id, scan);
  } catch {
    /* corrupt file — start fresh */
  }
}

export function saveScan(scan: ScanResult): void {
  scans.set(scan.id, scan);
  persist();
}

export function getScan(id: string): ScanResult | undefined {
  return scans.get(id);
}

export function listScans(): ScanResult[] {
  return [...scans.values()].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
}

export function updateScanMeta(
  scanId: string,
  patch: Partial<Pick<ScanResult, 'githubCommentUrl' | 'checkStatusUrl' | 'pullRequest'>>
): ScanResult | undefined {
  const scan = scans.get(scanId);
  if (!scan) return undefined;
  Object.assign(scan, patch);
  scans.set(scanId, scan);
  persist();
  return scan;
}

export function updateFinding(
  scanId: string,
  findingId: string,
  patch: Partial<ScanResult['findings'][number]>
): ScanResult['findings'][number] | undefined {
  const scan = scans.get(scanId);
  if (!scan) return undefined;

  const idx = scan.findings.findIndex((f) => f.id === findingId);
  if (idx === -1) return undefined;

  scan.findings[idx] = { ...scan.findings[idx], ...patch };
  recalcStats(scan);
  scans.set(scanId, scan);
  persist();
  return scan.findings[idx];
}

function recalcStats(scan: ScanResult): void {
  const open = scan.findings.filter((f) => !f.fixed);
  const critical = open.filter((f) => f.severity === 'critical').length;
  const warning = open.filter((f) => f.severity === 'warning').length;
  const info = open.filter((f) => f.severity === 'info').length;
  const resolved = scan.findings.filter((f) => f.fixed).length;
  const penalty = critical * 15 + warning * 5 + info;
  const score = Math.max(0, Math.min(100, 100 - penalty));

  scan.stats = { critical, warning, info, resolved, score };
}
