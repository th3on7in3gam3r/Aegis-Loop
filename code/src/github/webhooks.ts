import { config } from '../config.js';
import { scanDirectory } from '../scanner/index.js';
import { saveScan, updateScanMeta } from '../store.js';
import { queueScanCompleteEmail } from '../email/notifications.js';
import { UTM, withUtm } from '../utm.js';
import { ScanJobQueue, type ScanJob } from '../jobs/queue.js';
import { GitHubProvider } from '../providers/github.js';
import { ForgejoProvider } from '../providers/forgejo.js';
import type { GitProvider, PullRequestEvent, WebhookHeaders } from '../providers/types.js';

const github = new GitHubProvider();
const forgejo = new ForgejoProvider();
const providers: Record<string, GitProvider> = { github, forgejo };

export const scanJobs = new ScanJobQueue();

/**
 * Scan exactly the commit the webhook named, then publish to the PR.
 * Provider-agnostic: works for any GitProvider.
 */
export async function runPrScan(
  provider: GitProvider,
  event: PullRequestEvent
): Promise<string> {
  const meta = await provider.getPullRequest(event.repo, event.number);
  // Pin to the event's commit even if the PR has moved on since.
  const pullRequest = { ...meta, headSha: event.headSha };
  const checkout = await provider.checkoutCommit(event.repo, event.headSha);

  try {
    const scan = await scanDirectory(checkout.dir, event.repo, pullRequest.headBranch);
    scan.pullRequest = pullRequest;
    scan.provider = event.provider;
    scan.userLogin = event.actor;
    saveScan(scan);
    queueScanCompleteEmail(scan);

    const dashboardUrl = withUtm(`${config.appUrl}/app/?scan=${scan.id}`, UTM.githubPrComment);
    const { commentUrl, statusUrl } = await provider.publishReview(scan, dashboardUrl);
    updateScanMeta(scan.id, { githubCommentUrl: commentUrl, checkStatusUrl: statusUrl });
    return scan.id;
  } finally {
    checkout.cleanup();
  }
}

export async function runScanJob(job: ScanJob): Promise<{ scanId: string }> {
  const provider = providers[job.event.provider];
  if (!provider) throw new Error(`No provider registered for ${job.event.provider}`);
  return { scanId: await runPrScan(provider, job.event) };
}

export type WebhookResult = {
  handled: boolean;
  queued?: boolean;
  duplicate?: boolean;
  jobId?: string;
  message?: string;
};

export async function handleGitHubWebhook(
  payload: string,
  headers: WebhookHeaders
): Promise<WebhookResult> {
  if (!github.configured) {
    return { handled: false, message: 'Webhooks not configured (set GITHUB_WEBHOOK_SECRET)' };
  }
  if (!headers['x-hub-signature-256'] || !headers['x-github-event']) {
    throw new Error('Missing webhook headers');
  }
  if (!(await github.verifyWebhook(payload, headers))) {
    throw new Error('Invalid webhook signature');
  }

  const event = github.parseEvent(payload, headers);
  if (!event) {
    return { handled: true, message: 'Ignored event' };
  }
  if (!config.github.token) {
    return { handled: false, message: 'GITHUB_TOKEN required for webhook scans' };
  }

  const { job, duplicate } = await scanJobs.enqueue(event);
  return {
    handled: true,
    queued: !duplicate,
    duplicate,
    jobId: job.id,
    message: duplicate ? 'Duplicate delivery — scan already queued' : 'PR scan queued',
  };
}

/** Forge ONE: same pipeline, Forgejo webhooks. */
export async function handleForgejoWebhook(
  payload: string,
  headers: WebhookHeaders,
  provider: ForgejoProvider = forgejo,
  queue: ScanJobQueue = scanJobs
): Promise<WebhookResult> {
  if (!provider.configured) {
    return {
      handled: false,
      message: 'Forgejo not configured (set FORGEJO_URL, FORGEJO_TOKEN, FORGEJO_WEBHOOK_SECRET)',
    };
  }
  if (!(await provider.verifyWebhook(payload, headers))) {
    throw new Error('Invalid webhook signature');
  }
  const event = provider.parseEvent(payload, headers);
  if (!event) return { handled: true, message: 'Ignored event' };

  const { job, duplicate } = await queue.enqueue(event);
  return {
    handled: true,
    queued: !duplicate,
    duplicate,
    jobId: job.id,
    message: duplicate ? 'Duplicate delivery — scan already queued' : 'PR scan queued',
  };
}
