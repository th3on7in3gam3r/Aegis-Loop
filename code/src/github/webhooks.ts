import { Webhooks } from '@octokit/webhooks';
import { config } from '../config.js';
import { scanDirectory } from '../scanner/index.js';
import { saveScan, updateScanMeta } from '../store.js';
import { queueScanCompleteEmail } from '../email/notifications.js';
import { UTM, withUtm } from '../utm.js';
import { cleanupDir, clonePullRequest } from './clone.js';
import { fetchPullRequest, publishScanToGitHub } from './pr.js';

let webhooks: Webhooks | null = null;

function getWebhooks(): Webhooks | null {
  if (!config.github.webhookSecret) return null;
  if (!webhooks) {
    webhooks = new Webhooks({ secret: config.github.webhookSecret });
  }
  return webhooks;
}

async function runPrScan(
  owner: string,
  repo: string,
  pullNumber: number,
  token: string,
  userLogin: string
): Promise<string> {
  const pr = await fetchPullRequest(token, owner, repo, pullNumber);
  let tempDir: string | undefined;

  try {
    tempDir = await clonePullRequest(owner, repo, pr.headBranch, token);
    const scan = await scanDirectory(tempDir, `${owner}/${repo}`, pr.headBranch);
    scan.pullRequest = pr;
    scan.userLogin = userLogin;
    saveScan(scan);
    queueScanCompleteEmail(scan);

    const dashboardUrl = withUtm(
      `${config.appUrl}/app/?scan=${scan.id}`,
      UTM.githubPrComment
    );
    const { commentUrl, statusUrl } = await publishScanToGitHub(token, scan, dashboardUrl);
    updateScanMeta(scan.id, { githubCommentUrl: commentUrl, checkStatusUrl: statusUrl });

    return scan.id;
  } finally {
    if (tempDir) cleanupDir(tempDir);
  }
}

export async function handleGitHubWebhook(
  payload: string,
  signature: string | undefined,
  event: string | undefined
): Promise<{ handled: boolean; scanId?: string; message?: string }> {
  const hook = getWebhooks();
  if (!hook) {
    return { handled: false, message: 'Webhooks not configured (set GITHUB_WEBHOOK_SECRET)' };
  }

  if (!signature || !event) {
    throw new Error('Missing webhook headers');
  }

  const valid = await hook.verify(payload, signature);
  if (!valid) {
    throw new Error('Invalid webhook signature');
  }

  if (event !== 'pull_request') {
    return { handled: true, message: `Ignored event: ${event}` };
  }

  const data = JSON.parse(payload) as {
    action: string;
    pull_request: { number: number };
    repository: { name: string; owner: { login: string } };
  };

  if (!['opened', 'synchronize', 'reopened'].includes(data.action)) {
    return { handled: true, message: `Ignored PR action: ${data.action}` };
  }

  const token = config.github.token;
  if (!token) {
    return { handled: false, message: 'GITHUB_TOKEN required for webhook scans' };
  }

  const scanId = await runPrScan(
    data.repository.owner.login,
    data.repository.name,
    data.pull_request.number,
    token,
    data.repository.owner.login
  );

  return { handled: true, scanId, message: 'PR scan complete' };
}

export { runPrScan };
