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
 * Environment for git child processes.
 *
 * - The token travels as GIT_CONFIG_* environment variables (git >= 2.31),
 *   never as a command-line argument, so it can't be read from the process
 *   list by other users on the host.
 * - Only a minimal allowlist of the server's environment is passed through,
 *   so git (and any hooks/filters a repo might try to trigger) never sees
 *   DATABASE_URL, API keys or other production secrets.
 */
export function gitEnv(token?: string): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: tmpdir(),
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    // Never run repo-supplied hooks during checkout.
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: '/dev/null',
  };
  for (const key of ['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy', 'SSL_CERT_FILE', 'GIT_SSL_CAINFO']) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  if (token) {
    const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
    env.GIT_CONFIG_COUNT = '2';
    env.GIT_CONFIG_KEY_1 = 'http.extraHeader';
    env.GIT_CONFIG_VALUE_1 = `Authorization: Basic ${basic}`;
  }
  return env;
}

function git(dir?: string, token?: string) {
  // simple-git blocks GIT_CONFIG_* env and core.hooksPath by default; we set
  // them ourselves (auth header, hooks disabled), never from user input.
  return simpleGit({
    ...(dir ? { baseDir: dir } : {}),
    unsafe: { allowUnsafeConfigEnvCount: true, allowUnsafeHooksPath: true },
  }).env(gitEnv(token));
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
    await git(undefined, token).raw(['clone', '--depth', '1', '--branch', branch, url, dir]);
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
  const repoGit = git(dir, token);

  try {
    await repoGit.init();
    await repoGit.raw(['fetch', '--depth', '1', url, sha]);
    await repoGit.raw(['checkout', '--detach', 'FETCH_HEAD']);
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
