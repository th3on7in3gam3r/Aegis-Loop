import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);

export function walkFiles(rootDir: string, dir = rootDir): string[] {
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

export function readRepoFile(rootDir: string, relativePath: string): string | null {
  try {
    return readFileSync(join(rootDir, relativePath), 'utf8');
  } catch {
    return null;
  }
}

export function lineNumberAt(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

export function snippetAround(content: string, index: number, radius = 60): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(content.length, index + radius);
  return content.slice(start, end).trim();
}
