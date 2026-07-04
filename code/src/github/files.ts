import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { createOctokit } from './client.js';

export async function fetchRepoFileContent(
  token: string | undefined,
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<string> {
  if (token) {
    const octokit = createOctokit(token);
    const { data } = await octokit.repos.getContent({ owner, repo, path, ref });
    if (Array.isArray(data) || !('content' in data)) {
      throw new Error(`File not found: ${path}`);
    }
    return Buffer.from(data.content, 'base64').toString('utf8');
  }

  throw new Error('GitHub token required to fetch file for LLM autofix');
}

export function fetchDemoFileContent(filePath: string): string {
  return readFileSync(join(config.demoRepo, filePath), 'utf8');
}

export async function resolveFindingFileContent(
  scan: { repo: string; branch: string },
  filePath: string,
  token?: string
): Promise<string> {
  if (scan.repo === 'aegis-loop/sample-app') {
    return fetchDemoFileContent(filePath);
  }

  const [owner, repo] = scan.repo.split('/');
  if (!token) throw new Error('Connect GitHub to generate LLM autofix for remote repos');
  return fetchRepoFileContent(token, owner, repo, filePath, scan.branch);
}
