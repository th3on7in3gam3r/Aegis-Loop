import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';

export function parseRepoInput(input: string): { owner: string; repo: string; url: string } {
  const trimmed = input.trim().replace(/\/$/, '');

  const ssh = trimmed.match(/git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (ssh) {
    return { owner: ssh[1], repo: ssh[2], url: `https://github.com/${ssh[1]}/${ssh[2]}.git` };
  }

  const https = trimmed.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (https) {
    return { owner: https[1], repo: https[2], url: `https://github.com/${https[1]}/${https[2]}.git` };
  }

  const short = trimmed.match(/^([^/]+)\/([^/]+)$/);
  if (short) {
    return { owner: short[1], repo: short[2], url: `https://github.com/${short[1]}/${short[2]}.git` };
  }

  throw new Error('Invalid repo — use owner/repo or a GitHub URL');
}

export function parsePrInput(input: string): { owner: string; repo: string; pullNumber: number } {
  const trimmed = input.trim();

  const urlMatch = trimmed.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2], pullNumber: Number(urlMatch[3]) };
  }

  const hashMatch = trimmed.match(/^([^/]+)\/([^/#]+)#(\d+)$/);
  if (hashMatch) {
    return { owner: hashMatch[1], repo: hashMatch[2], pullNumber: Number(hashMatch[3]) };
  }

  throw new Error('Invalid PR — use owner/repo#123 or a GitHub PR URL');
}

function authCloneUrl(owner: string, repo: string, token?: string): string {
  if (token) {
    return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  }
  return `https://github.com/${owner}/${repo}.git`;
}

export async function cloneRepo(
  owner: string,
  repo: string,
  branch: string,
  token?: string
): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'aegis-scan-'));
  const git = simpleGit();
  const url = authCloneUrl(owner, repo, token);

  try {
    await git.clone(url, dir, ['--depth', '1', '--branch', branch]);
  } catch (err) {
    cleanupDir(dir);
    const detail = err instanceof Error ? err.message : 'clone failed';
    throw new Error(`Could not clone ${owner}/${repo}@${branch}: ${detail}`);
  }

  return dir;
}

export async function clonePullRequest(
  owner: string,
  repo: string,
  headBranch: string,
  token?: string
): Promise<string> {
  return cloneRepo(owner, repo, headBranch, token);
}

export function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
