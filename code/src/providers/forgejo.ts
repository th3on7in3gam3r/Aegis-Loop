import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import type { PullRequestMeta, ScanResult } from '../types.js';
import { checkoutCommitFromUrl, cleanupDir } from '../github/clone.js';
import { BOT_COMMENT_MARKER, findOwnBotComment, formatPrComment } from '../github/pr.js';
import {
  header,
  splitRepo,
  type Checkout,
  type GitProvider,
  type PublishResult,
  type PullRequestEvent,
  type WebhookHeaders,
} from './types.js';

/**
 * Forgejo (and Gitea, which shares the API) provider for Forge ONE.
 *
 * - Webhooks: `X-Forgejo-Signature` is a hex HMAC-SHA256 of the raw body
 *   (Gitea sends the same value as `X-Gitea-Signature`).
 * - API: `/api/v1`, authenticated with `Authorization: token <token>`.
 * - Git: exact-commit fetch with the token as an HTTP header (env-only, see
 *   `gitEnv`), never in the URL or argv.
 */

/** Forgejo says `synchronized` where GitHub says `synchronize`. */
const SCANNED_ACTIONS = new Set(['opened', 'reopened', 'synchronized', 'synchronize']);

type ForgejoUser = { login?: string; username?: string };

type PullRequestPayload = {
  action?: string;
  number?: number;
  pull_request?: {
    number: number;
    head?: { sha?: string; ref?: string };
  };
  repository?: { full_name?: string; name?: string; owner?: ForgejoUser };
  sender?: ForgejoUser;
};

type ForgejoComment = { id: number; body?: string; html_url?: string; user?: ForgejoUser };

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class ForgejoApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    detail: string
  ) {
    super(
      status === 401 || status === 403
        ? `Forgejo token lacks permission for ${path} (HTTP ${status}). Grant it repository read and issue/status write access.`
        : `Forgejo API ${path} failed (HTTP ${status}): ${detail}`
    );
  }
}

export interface ForgejoOptions {
  baseUrl?: string;
  token?: string;
  webhookSecret?: string;
  fetch?: FetchLike;
}

const login = (u?: ForgejoUser) => u?.login ?? u?.username ?? '';

/**
 * The token is sent to FORGEJO_URL, so only accept a plain HTTPS origin
 * (no credentials, path, query or fragment). Plain HTTP is allowed only for
 * localhost, for local testing. Returns the normalised origin.
 */
export function validateForgejoUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`FORGEJO_URL is not a valid URL: ${raw}`);
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('FORGEJO_URL must use https:// (http is only allowed for localhost)');
  }
  if (url.username || url.password) throw new Error('FORGEJO_URL must not contain credentials');
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    throw new Error('FORGEJO_URL must be just the server origin, e.g. https://git.example.com');
  }
  return url.origin;
}

export class ForgejoProvider implements GitProvider {
  readonly id = 'forgejo' as const;
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly webhookSecret: string;
  private readonly fetchImpl: FetchLike;
  private identity: Promise<string> | null = null;

  constructor(opts: ForgejoOptions = {}) {
    const raw = (opts.baseUrl ?? config.forgejo.url).replace(/\/+$/, '');
    let baseUrl = '';
    if (raw) {
      try {
        baseUrl = validateForgejoUrl(raw);
      } catch (err) {
        // Disable Forgejo rather than crash the whole server on a bad setting.
        console.error(`[forgejo] disabled: ${err instanceof Error ? err.message : err}`);
      }
    }
    this.baseUrl = baseUrl;
    this.token = opts.token ?? config.forgejo.token;
    this.webhookSecret = opts.webhookSecret ?? config.forgejo.webhookSecret;
    this.fetchImpl = opts.fetch ?? ((url, init) => fetch(url, init));
  }

  get configured(): boolean {
    return Boolean(this.baseUrl && this.token && this.webhookSecret);
  }

  async verifyWebhook(rawBody: string, headers: WebhookHeaders): Promise<boolean> {
    const given = header(headers, 'x-forgejo-signature') ?? header(headers, 'x-gitea-signature');
    if (!this.webhookSecret || !given || !/^[0-9a-f]{64}$/i.test(given)) return false;
    const expected = createHmac('sha256', this.webhookSecret).update(rawBody).digest();
    return timingSafeEqual(expected, Buffer.from(given, 'hex'));
  }

  parseEvent(rawBody: string, headers: WebhookHeaders): PullRequestEvent | null {
    const event = header(headers, 'x-forgejo-event') ?? header(headers, 'x-gitea-event');
    if (event !== 'pull_request') return null;
    const data = JSON.parse(rawBody) as PullRequestPayload;
    if (!data.action || !SCANNED_ACTIONS.has(data.action)) return null;

    const pr = data.pull_request;
    const headSha = pr?.head?.sha;
    const owner = login(data.repository?.owner);
    const repoId =
      data.repository?.full_name ?? (owner && data.repository?.name ? `${owner}/${data.repository.name}` : '');
    if (!pr || !headSha || !repoId) return null;

    return {
      provider: this.id,
      deliveryId:
        header(headers, 'x-forgejo-delivery') ??
        header(headers, 'x-gitea-delivery') ??
        `${repoId}#${pr.number}@${headSha}`,
      repo: repoId,
      number: pr.number,
      headSha,
      headBranch: pr.head?.ref ?? '',
      actor: owner || login(data.sender),
    };
  }

  async getPullRequest(repo: string, number: number): Promise<PullRequestMeta> {
    const { owner, name } = splitRepo(repo);
    const data = await this.api<{
      number: number;
      html_url: string;
      title: string;
      head: { ref: string; sha: string };
      base: { ref: string };
    }>('GET', `/repos/${enc(owner)}/${enc(name)}/pulls/${number}`);
    return {
      number: data.number,
      url: data.html_url,
      title: data.title,
      headBranch: data.head.ref,
      baseBranch: data.base.ref,
      headSha: data.head.sha,
    };
  }

  async checkoutCommit(repo: string, sha: string): Promise<Checkout> {
    const { owner, name } = splitRepo(repo);
    const dir = await checkoutCommitFromUrl({
      url: `${this.requireBaseUrl()}/${owner}/${name}.git`,
      sha,
      authHeader: `token ${this.requireToken()}`,
      label: repo,
      secret: this.token,
    });
    return { dir, cleanup: () => cleanupDir(dir) };
  }

  async publishReview(scan: ScanResult, dashboardUrl: string): Promise<PublishResult> {
    if (!scan.pullRequest) throw new Error('Scan is not linked to a pull request');
    const { owner, name } = splitRepo(scan.repo);
    const { number, headSha } = scan.pullRequest;
    const body = `${BOT_COMMENT_MARKER}\n${formatPrComment(scan, dashboardUrl)}`;

    const [ownLogin, comments] = await Promise.all([
      this.ownLogin(),
      this.api<ForgejoComment[]>('GET', `/repos/${enc(owner)}/${enc(name)}/issues/${number}/comments`),
    ]);
    // findOwnBotComment expects GitHub's `user.login`; Forgejo also uses `login`.
    const existing = findOwnBotComment(
      comments.map((c) => ({ ...c, user: { login: login(c.user), type: 'User' } })),
      ownLogin
    );

    const comment = existing
      ? await this.api<ForgejoComment>(
          'PATCH',
          `/repos/${enc(owner)}/${enc(name)}/issues/comments/${existing.id}`,
          { body }
        )
      : await this.api<ForgejoComment>(
          'POST',
          `/repos/${enc(owner)}/${enc(name)}/issues/${number}/comments`,
          { body }
        );

    await this.api('POST', `/repos/${enc(owner)}/${enc(name)}/statuses/${headSha}`, statusFor(scan, dashboardUrl));

    return {
      commentUrl: comment.html_url ?? `${this.baseUrl}/${owner}/${name}/pulls/${number}`,
      statusUrl: `${this.baseUrl}/${owner}/${name}/commit/${headSha}`,
    };
  }

  /**
   * Login of the account behind the token, so we only ever edit our own
   * comment. Required: without it we can't tell our comment from a copy, and
   * would either risk editing someone else's or post a duplicate every push.
   */
  private ownLogin(): Promise<string> {
    this.identity ??= this.api<ForgejoUser>('GET', '/user')
      .then((u) => {
        const name = login(u);
        if (!name) throw new Error('Forgejo /user returned no login');
        return name;
      })
      .catch((err) => {
        this.identity = null; // allow a retry on the next job
        throw new Error(
          `Forgejo token can't read its own account (GET /user). Give the bot token the read:user scope. ${err instanceof Error ? err.message : ''}`.trim()
        );
      });
    return this.identity;
  }

  private async api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.requireBaseUrl()}/api/v1${path}`, {
      method,
      headers: {
        Authorization: `token ${this.requireToken()}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 200);
      throw new ForgejoApiError(res.status, path, text);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private requireToken(): string {
    if (!this.token) throw new Error('FORGEJO_TOKEN required for Forgejo scans');
    return this.token;
  }

  private requireBaseUrl(): string {
    if (!this.baseUrl) throw new Error('FORGEJO_URL required for Forgejo scans');
    return this.baseUrl;
  }
}

function enc(segment: string): string {
  return encodeURIComponent(segment);
}

/** Forgejo supports a `warning` state, so warnings don't masquerade as pending. */
export function statusFor(scan: ScanResult, dashboardUrl: string) {
  const { stats } = scan;
  const state = stats.critical > 0 ? 'failure' : stats.warning > 0 ? 'warning' : 'success';
  const description =
    stats.critical + stats.warning === 0
      ? 'No security issues found'
      : `${stats.critical} critical, ${stats.warning} warnings`;
  return { state, context: 'aegis-loop/code', description, target_url: dashboardUrl };
}
