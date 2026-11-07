import type { PullRequestMeta, ScanResult } from '../types.js';

/**
 * A Git hosting provider (GitHub today, Forgejo next).
 *
 * Provider code is responsible only for authentication, webhooks, fetching
 * source and publishing results. Scanning itself stays provider-agnostic
 * (`scanDirectory`).
 */
export type ProviderId = 'github' | 'forgejo';

export type WebhookHeaders = Record<string, string | string[] | undefined>;

/** A pull request event worth scanning, normalised across providers. */
export interface PullRequestEvent {
  provider: ProviderId;
  /** Provider's unique delivery id — retries reuse it, so it dedupes. */
  deliveryId: string;
  /** `owner/name` */
  repo: string;
  number: number;
  headSha: string;
  headBranch: string;
  /** Account the scan is attributed to. */
  actor: string;
}

export interface Checkout {
  dir: string;
  cleanup(): void;
}

export interface PublishResult {
  commentUrl: string;
  statusUrl: string;
}

export interface GitProvider {
  readonly id: ProviderId;

  /** Verify the webhook signature against the raw request body. */
  verifyWebhook(rawBody: string, headers: WebhookHeaders): Promise<boolean>;

  /**
   * Turn a verified webhook into a scan request, or `null` for events we
   * ignore (other event types, closed PRs, …).
   */
  parseEvent(rawBody: string, headers: WebhookHeaders): PullRequestEvent | null;

  getPullRequest(repo: string, number: number): Promise<PullRequestMeta>;

  /** Check out exactly `sha` into a temp dir. */
  checkoutCommit(repo: string, sha: string): Promise<Checkout>;

  /**
   * Post results to the PR: update the existing bot comment (never stack a
   * new one per rerun) and set the commit status for `scan.pullRequest.headSha`.
   */
  publishReview(scan: ScanResult, dashboardUrl: string): Promise<PublishResult>;
}

export function header(headers: WebhookHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export function splitRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split('/');
  if (!owner || !name) throw new Error(`Invalid repo id: ${repo}`);
  return { owner, name };
}
