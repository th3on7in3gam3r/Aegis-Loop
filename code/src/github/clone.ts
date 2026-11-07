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

const GITHUB_HOST = 'https://github.com';

/**
 * Pass the token as an HTTP header instead of embedding it in the clone URL,
 * so it never appears in git's error output, process lists or logs.
 */
function authArgs(token?: string): string[] {
  if (!token) return [];
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  return ['-c', `http.extraHeader=Authorization: Basic ${basic}`];
}

/** Strip anything that looks like a credential from a git error message. */
export function redactGitError(message: string, token?: string): string {
  let out = message.replace(/(https?:\/\/)[^/@\s]+@/g, '$1***@');
  out = out.replace(/(Authorization: )\S+( \S+)?/gi, '$1***');
  if (token) out = out.split(token).join('***');
  return out;
}

function cloneError(owner: string, repo: string, ref: string, err: unknown, token?: string): Error {
  const detail = err instanceof Error ? err.message : 'clone failed';
  return new Error(`Could not clone ${owner}/${repo}@${ref}: ${redactGitError(detail, token)}`);
}

export async function cloneRepo(
  owner: string,
  repo: string,
  branch: string,
  token?: string
): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'aegis-scan-'));
  const url = `${GITHUB_HOST}/${owner}/${repo}.git`;

  try {
    await simpleGit().raw([...authArgs(token), 'clone', '--depth', '1', '--branch', branch, url, dir]);
  } catch (err) {
    cleanupDir(dir);
    throw cloneError(owner, repo, branch, err, token);
  }

  return dir;
}

/**
 * Check out one exact commit. Scanning a pinned SHA (rather than the branch
 * tip) means a push that lands mid-scan can't make results describe the
 * wrong code.
 */
export async function cloneAtCommit(
  owner: string,
  repo: string,
  sha: string,
  token?: string
): Promise<string> {
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw new Error(`Invalid commit SHA: ${sha}`);
  const dir = mkdtempSync(join(tmpdir(), 'aegis-scan-'));
  const url = `${GITHUB_HOST}/${owner}/${repo}.git`;
  const git = simpleGit(dir);

  try {
    await git.init();
    await git.raw([...authArgs(token), 'fetch', '--depth', '1', url, sha]);
    await git.raw(['checkout', '--detach', 'FETCH_HEAD']);
  } catch (err) {
    cleanupDir(dir);
    throw cloneError(owner, repo, sha.slice(0, 12), err, token);
  }

  return dir;
}

export async function clonePullRequest(
  owner: string,
  repo: string,
  headBranch: string,
  token?: string,
  headSha?: string
): Promise<string> {
  if (headSha) return cloneAtCommit(owner, repo, headSha, token);
  return cloneRepo(owner, repo, headBranch, token);
}

export function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
