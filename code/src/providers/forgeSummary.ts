import { timingSafeEqual } from 'node:crypto';
import type { ScanResult } from '../types.js';

/**
 * Forge ONE dashboard summary: the latest successful code scan for each
 * requested Forgejo repository. Used server-to-server by the Forge ONE Home
 * service (Bearer token), never by browsers.
 */

export const MAX_SUMMARY_REPOS = 500;

export type RepoSummary = {
  repo: string;
  score: number;
  critical: number;
  warning: number;
  info: number;
  sha: string | null;
  prNumber: number | null;
  scannedAt: string;
};

/** Constant-time Bearer token check. An empty configured token disables the endpoint. */
export function summaryTokenValid(header: string | undefined, configured: string): boolean {
  if (!configured) return false;
  const match = /^Bearer\s+(.+)$/i.exec(header ?? '');
  if (!match) return false;
  const given = Buffer.from(match[1].trim());
  const expected = Buffer.from(configured);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Validates the request body; returns the repo list or an error message. */
export function parseSummaryRequest(body: unknown): { repos: string[] } | { error: string } {
  const b = (body ?? {}) as { provider?: unknown; repos?: unknown };
  if (b.provider !== 'forgejo') return { error: 'provider must be "forgejo"' };
  if (!Array.isArray(b.repos)) return { error: 'repos must be an array of "owner/name" strings' };
  if (b.repos.length > MAX_SUMMARY_REPOS) return { error: `at most ${MAX_SUMMARY_REPOS} repos per request` };
  const repos = b.repos.filter((r): r is string => typeof r === 'string' && /^[\w.-]+\/[\w.-]+$/.test(r));
  return { repos: [...new Set(repos)] };
}

/** True when a scan came from the Forgejo instance at `forgejoOrigin`. */
export function isForgejoScan(scan: ScanResult, forgejoOrigin: string): boolean {
  if (scan.provider) return scan.provider === 'forgejo';
  // Scans saved before `provider` existed: trust the PR link's origin.
  if (!forgejoOrigin || !scan.pullRequest?.url) return false;
  try {
    return new URL(scan.pullRequest.url).origin === forgejoOrigin;
  } catch {
    return false;
  }
}

/** Latest complete code scan per requested repo (repos without one are omitted). */
export function latestForgeScans(
  scans: ScanResult[],
  repos: string[],
  forgejoOrigin: string
): RepoSummary[] {
  const wanted = new Set(repos);
  const latest = new Map<string, ScanResult>();
  const when = (s: ScanResult) => new Date(s.completedAt ?? s.startedAt).getTime();

  for (const scan of scans) {
    if (scan.status !== 'complete') continue;
    if ((scan.module ?? 'code') !== 'code') continue;
    if (!wanted.has(scan.repo)) continue;
    if (!isForgejoScan(scan, forgejoOrigin)) continue;
    const prev = latest.get(scan.repo);
    if (!prev || when(scan) > when(prev)) latest.set(scan.repo, scan);
  }

  return [...latest.values()].map((s) => ({
    repo: s.repo,
    score: s.stats.score,
    critical: s.stats.critical,
    warning: s.stats.warning,
    info: s.stats.info,
    sha: s.pullRequest?.headSha ?? null,
    prNumber: s.pullRequest?.number ?? null,
    scannedAt: s.completedAt ?? s.startedAt,
  }));
}
