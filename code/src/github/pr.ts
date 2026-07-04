import { createOctokit } from './client.js';
import type { PullRequestMeta, ScanResult } from '../types.js';

export async function fetchPullRequest(
  token: string | undefined,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<PullRequestMeta> {
  const octokit = createOctokit(token);
  const { data } = await octokit.pulls.get({ owner, repo, pull_number: pullNumber });

  return {
    number: data.number,
    url: data.html_url,
    title: data.title,
    headBranch: data.head.ref,
    baseBranch: data.base.ref,
    headSha: data.head.sha,
  };
}

export function formatPrComment(scan: ScanResult, dashboardUrl: string): string {
  const { stats, findings, pullRequest } = scan;
  const open = findings.filter((f) => !f.fixed);
  const icon = stats.critical > 0 ? '🔴' : stats.warning > 0 ? '🟡' : '🟢';

  const lines = [
    `## ${icon} Aegis Loop / code — security scan`,
    '',
    pullRequest ? `**PR #${pullRequest.number}:** ${pullRequest.title}` : '',
    '',
    '| Severity | Count |',
    '|----------|-------|',
    `| 🔴 Critical | ${stats.critical} |`,
    `| 🟡 Warning | ${stats.warning} |`,
    `| 🔵 Info | ${stats.info} |`,
    '',
    `**Security score:** ${stats.score}/100`,
    '',
  ].filter(Boolean);

  if (open.length === 0) {
    lines.push('No open security findings. Clean scan.');
  } else {
    lines.push('<details>', '<summary>Findings</summary>', '');
    for (const f of open.slice(0, 15)) {
      const badge = f.severity === 'critical' ? '🔴' : f.severity === 'warning' ? '🟡' : '🔵';
      lines.push(
        `- ${badge} **${f.title}** — \`${f.file}:${f.line}\``,
        `  - ${f.message}${f.autofix ? ' *(autofix available)*' : ''}`
      );
    }
    if (open.length > 15) {
      lines.push('', `_…and ${open.length - 15} more_`);
    }
    lines.push('</details>', '');
  }

  lines.push(
    `[View full report in Aegis Loop](${dashboardUrl})`,
    '',
    '---',
    '*Powered by [Aegis Loop](https://github.com) / code*'
  );

  return lines.join('\n');
}

export async function postPrComment(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number,
  body: string
): Promise<string> {
  const octokit = createOctokit(token);
  const { data } = await octokit.issues.createComment({
    owner,
    repo,
    issue_number: pullNumber,
    body,
  });
  return data.html_url;
}

export async function updateExistingBotComment(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number,
  body: string
): Promise<string> {
  const octokit = createOctokit(token);
  const marker = 'Aegis Loop / code — security scan';

  const { data: comments } = await octokit.issues.listComments({
    owner,
    repo,
    issue_number: pullNumber,
    per_page: 100,
  });

  const existing = comments.find((c) => c.body?.includes(marker));
  if (existing) {
    const { data } = await octokit.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body,
    });
    return data.html_url;
  }

  return postPrComment(token, owner, repo, pullNumber, body);
}

export async function setCommitStatus(
  token: string,
  owner: string,
  repo: string,
  sha: string,
  scan: ScanResult,
  dashboardUrl: string
): Promise<string> {
  const octokit = createOctokit(token);
  const { stats } = scan;

  let state: 'success' | 'failure' | 'pending' | 'error' = 'success';
  if (stats.critical > 0) state = 'failure';
  else if (stats.warning > 0) state = 'pending';

  const description =
    stats.critical + stats.warning === 0
      ? 'No security issues found'
      : `${stats.critical} critical, ${stats.warning} warnings`;

  await octokit.repos.createCommitStatus({
    owner,
    repo,
    sha,
    state,
    context: 'aegis-loop/code',
    description,
    target_url: dashboardUrl,
  });

  return `https://github.com/${owner}/${repo}/commit/${sha}`;
}

export async function createAutofixPr(options: {
  token: string;
  owner: string;
  repo: string;
  baseBranch: string;
  filePath: string;
  content: string;
  commitMessage: string;
  prTitle: string;
  prBody: string;
}): Promise<string> {
  const octokit = createOctokit(options.token);
  const branch = `aegis-loop/autofix-${Date.now()}`;

  const ref = await octokit.git.getRef({
    owner: options.owner,
    repo: options.repo,
    ref: `heads/${options.baseBranch}`,
  });

  await octokit.git.createRef({
    owner: options.owner,
    repo: options.repo,
    ref: `refs/heads/${branch}`,
    sha: ref.data.object.sha,
  });

  let fileSha: string | undefined;
  try {
    const existing = await octokit.repos.getContent({
      owner: options.owner,
      repo: options.repo,
      path: options.filePath,
      ref: branch,
    });
    if (!Array.isArray(existing.data) && 'sha' in existing.data) {
      fileSha = existing.data.sha;
    }
  } catch {
    /* new file */
  }

  await octokit.repos.createOrUpdateFileContents({
    owner: options.owner,
    repo: options.repo,
    path: options.filePath,
    message: options.commitMessage,
    content: Buffer.from(options.content).toString('base64'),
    branch,
    sha: fileSha,
  });

  const pr = await octokit.pulls.create({
    owner: options.owner,
    repo: options.repo,
    title: options.prTitle,
    head: branch,
    base: options.baseBranch,
    body: options.prBody,
  });

  return pr.data.html_url;
}

/** Push autofix commit directly onto a branch (e.g. PR head). */
export async function pushAutofixToBranch(options: {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  filePath: string;
  content: string;
  commitMessage: string;
}): Promise<string> {
  const octokit = createOctokit(options.token);

  let fileSha: string | undefined;
  try {
    const existing = await octokit.repos.getContent({
      owner: options.owner,
      repo: options.repo,
      path: options.filePath,
      ref: options.branch,
    });
    if (!Array.isArray(existing.data) && 'sha' in existing.data) {
      fileSha = existing.data.sha;
    }
  } catch {
    /* new file */
  }

  const { data } = await octokit.repos.createOrUpdateFileContents({
    owner: options.owner,
    repo: options.repo,
    path: options.filePath,
    message: options.commitMessage,
    content: Buffer.from(options.content).toString('base64'),
    branch: options.branch,
    sha: fileSha,
  });

  return data.commit?.html_url ?? `https://github.com/${options.owner}/${options.repo}`;
}

export async function publishScanToGitHub(
  token: string,
  scan: ScanResult,
  dashboardUrl: string
): Promise<{ commentUrl: string; statusUrl: string }> {
  if (!scan.pullRequest) {
    throw new Error('Scan is not linked to a pull request');
  }

  const [owner, repo] = scan.repo.split('/');
  const { number, headSha } = scan.pullRequest;
  const body = formatPrComment(scan, dashboardUrl);

  const commentUrl = await updateExistingBotComment(token, owner, repo, number, body);
  const statusUrl = await setCommitStatus(token, owner, repo, headSha, scan, dashboardUrl);

  return { commentUrl, statusUrl };
}
