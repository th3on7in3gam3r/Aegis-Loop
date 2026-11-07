import { Webhooks } from '@octokit/webhooks';
import { config } from '../config.js';
import type { PullRequestMeta, ScanResult } from '../types.js';
import { cleanupDir, cloneAtCommit } from '../github/clone.js';
import { fetchPullRequest, publishScanToGitHub } from '../github/pr.js';
import {
  header,
  splitRepo,
  type Checkout,
  type GitProvider,
  type PublishResult,
  type PullRequestEvent,
  type WebhookHeaders,
} from './types.js';

const SCANNED_ACTIONS = new Set(['opened', 'synchronize', 'reopened']);

type PullRequestPayload = {
  action?: string;
  pull_request?: { number: number; head?: { sha?: string; ref?: string } };
  repository?: { name: string; owner: { login: string } };
  sender?: { login?: string };
};

export class GitHubProvider implements GitProvider {
  readonly id = 'github' as const;
  private webhooks: Webhooks | null = null;

  constructor(
    private readonly token: string | undefined = config.github.token,
    private readonly webhookSecret: string | undefined = config.github.webhookSecret
  ) {}

  get configured(): boolean {
    return Boolean(this.webhookSecret);
  }

  async verifyWebhook(rawBody: string, headers: WebhookHeaders): Promise<boolean> {
    const signature = header(headers, 'x-hub-signature-256');
    if (!this.webhookSecret || !signature) return false;
    this.webhooks ??= new Webhooks({ secret: this.webhookSecret });
    try {
      return await this.webhooks.verify(rawBody, signature);
    } catch {
      return false;
    }
  }

  parseEvent(rawBody: string, headers: WebhookHeaders): PullRequestEvent | null {
    if (header(headers, 'x-github-event') !== 'pull_request') return null;
    const data = JSON.parse(rawBody) as PullRequestPayload;
    if (!data.action || !SCANNED_ACTIONS.has(data.action)) return null;
    const pr = data.pull_request;
    const repo = data.repository;
    const headSha = pr?.head?.sha;
    if (!pr || !repo || !headSha) return null;

    const repoId = `${repo.owner.login}/${repo.name}`;
    return {
      provider: this.id,
      // Fall back to a commit-scoped id so redeliveries without the header
      // still collapse onto one job.
      deliveryId: header(headers, 'x-github-delivery') ?? `${repoId}#${pr.number}@${headSha}`,
      repo: repoId,
      number: pr.number,
      headSha,
      headBranch: pr.head?.ref ?? '',
      actor: repo.owner.login,
    };
  }

  async getPullRequest(repo: string, number: number): Promise<PullRequestMeta> {
    const { owner, name } = splitRepo(repo);
    return fetchPullRequest(this.requireToken(), owner, name, number);
  }

  async checkoutCommit(repo: string, sha: string): Promise<Checkout> {
    const { owner, name } = splitRepo(repo);
    const dir = await cloneAtCommit(owner, name, sha, this.token);
    return { dir, cleanup: () => cleanupDir(dir) };
  }

  async publishReview(scan: ScanResult, dashboardUrl: string): Promise<PublishResult> {
    return publishScanToGitHub(this.requireToken(), scan, dashboardUrl);
  }

  private requireToken(): string {
    if (!this.token) throw new Error('GITHUB_TOKEN required for webhook scans');
    return this.token;
  }
}
