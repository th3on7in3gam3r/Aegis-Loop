import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Finding, ScanResult } from '../types.js';
import { runOsvDependencyScan } from './rules/dependencies.js';
import { injectionRule } from './rules/injection.js';
import { secretsRule } from './rules/secrets.js';

const SYNC_RULES = [secretsRule, injectionRule];

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
]);

function walkFiles(rootDir: string, dir = rootDir): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walkFiles(rootDir, full));
    } else {
      files.push(relative(rootDir, full));
    }
  }

  return files;
}

function calcStats(findings: Finding[]) {
  const open = findings.filter((f) => !f.fixed);
  const critical = open.filter((f) => f.severity === 'critical').length;
  const warning = open.filter((f) => f.severity === 'warning').length;
  const info = open.filter((f) => f.severity === 'info').length;
  const resolved = findings.filter((f) => f.fixed).length;
  const penalty = critical * 15 + warning * 5 + info;
  const score = Math.max(0, Math.min(100, 100 - penalty));
  return { critical, warning, info, resolved, score };
}

export async function scanDirectory(
  rootDir: string,
  repoLabel: string,
  branch = 'main'
): Promise<ScanResult> {
  const scanId = randomUUID();
  const files = walkFiles(rootDir);

  const readFile = (relativePath: string) => {
    try {
      return readFileSync(join(rootDir, relativePath), 'utf8');
    } catch {
      return null;
    }
  };

  const ctx = {
    scanId,
    rootDir,
    readFile,
    listFiles: () => files,
  };

  const syncDrafts = SYNC_RULES.flatMap((rule) => rule.run(ctx));
  const osvDrafts = await runOsvDependencyScan(ctx);
  const drafts = [...syncDrafts, ...osvDrafts];

  const findings: Finding[] = drafts.map((draft) => ({
    ...draft,
    id: randomUUID(),
    scanId,
    fixed: false,
  }));

  const now = new Date().toISOString();

  return {
    id: scanId,
    repo: repoLabel,
    branch,
    status: 'complete',
    startedAt: now,
    completedAt: now,
    findings,
    stats: calcStats(findings),
  };
}
