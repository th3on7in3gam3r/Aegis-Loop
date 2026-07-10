import './load-env.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { config, llmConfigured, oauthConfigured } from './config.js';
import { resolveAutofix } from './autofix.js';
import {
  exchangeCode,
  listUserRepos,
  sessionFromPat,
  startOAuth,
  consumeOAuthState,
} from './github/auth.js';
import { cleanupDir, clonePullRequest, cloneRepo, parsePrInput, parseRepoInput } from './github/clone.js';
import {
  createAutofixPr,
  fetchPullRequest,
  formatPrComment,
  publishScanToGitHub,
  pushAutofixToBranch,
  updateExistingBotComment,
} from './github/pr.js';
import { handleGitHubWebhook } from './github/webhooks.js';
import { scanDirectory } from './scanner/index.js';
import { scanCloudDirectory } from './modules/cloud/scanner.js';
import { scanAttackTarget, scanAttackTargets } from './modules/attack/scanner.js';
import { summarizeUrlCheck } from './modules/attack/url-check.js';
import {
  evaluateProtectRequest,
  listProtectEvents,
  listProtectRules,
  loadProtectStore,
  protectStats,
  setProtectRuleEnabled,
  syncProtectRulesFromScans,
} from './modules/protect/store.js';
import {
  clearSessionCookie,
  getSession,
  requireSession,
  resolveToken,
  setSessionCookie,
} from './session.js';
import { loadSessionStore } from './sessionStore.js';
import { dbConfigured } from './db.js';
import { requireAuth, resolveAuth } from './billing/auth.js';
import { assertAutofixAccess, assertModuleAccess, canScanRepo, planSummary } from './billing/limits.js';
import { getAccountForUser, syncOwnerPlan } from './billing/owners.js';
import {
  createApiKey,
  accountExists,
  loadAccountStore,
  revokeApiKey,
} from './billing/store.js';
import { emitUserSignup } from './billing/studioOps.js';
import {
  createBillingPortalSession,
  createCheckoutSession,
  handleStripeWebhook,
  stripeConfigured,
  syncBillingFromStripe,
} from './billing/stripe.js';
import {
  handleStudioBillingPartnerEvent,
  verifyStudioBillingSignature,
  type StudioBillingPartnerEvent,
} from './billing/studioPartner.js';
import { getScan, listScans, loadStore, saveScan, updateFinding, updateScanMeta } from './store.js';
import {
  appBase,
  injectLandingSeo,
  llmsTxt,
  robotsTxt,
  sitemapXml,
} from './seo.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '../..');
const PUBLIC_DIR = join(__dirname, '../public');
const LEGAL_DIR = join(ROOT_DIR, 'legal');

const app = Fastify({ logger: true });

await loadStore();
await loadProtectStore();
await loadAccountStore();
await loadSessionStore();

// Fixed-window per-key rate limiter (in-memory; fine for single instance)
function makeRateLimiter(limit: number, windowMs: number) {
  const buckets = new Map<string, { count: number; reset: number }>();
  return (key: string): boolean => {
    const now = Date.now();
    if (buckets.size > 10_000) {
      for (const [k, row] of buckets) {
        if (now > row.reset) buckets.delete(k);
      }
    }
    const row = buckets.get(key);
    if (!row || now > row.reset) {
      buckets.set(key, { count: 1, reset: now + windowMs });
      return true;
    }
    row.count += 1;
    return row.count <= limit;
  };
}

const urlCheckRateOk = makeRateLimiter(10, 60_000);
const scanRateOk = makeRateLimiter(12, 60_000);
const authRateOk = makeRateLimiter(10, 60_000);

function rateLimited(reply: import('fastify').FastifyReply) {
  return reply.status(429).send({ error: 'Rate limit exceeded — try again in a minute' });
}

function tagScan<T extends import('./types.js').ScanResult>(scan: T, login: string): T {
  scan.userLogin = login;
  return scan;
}

function planLimitReply(reply: import('fastify').FastifyReply, message: string) {
  return reply.status(402).send({
    error: message,
    code: 'PLAN_LIMIT',
    upgradeUrl: `${config.appUrl}/app/?checkout=team`,
  });
}

await app.register(fastifyCookie, { secret: config.sessionSecret });
await app.register(cors, { origin: true });

// Security headers (the same hygiene the Attack module probes for)
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https://avatars.githubusercontent.com",
  "connect-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

app.addHook('onSend', async (_req, reply) => {
  reply.header('Content-Security-Policy', CSP);
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'SAMEORIGIN');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (config.appUrl.startsWith('https://')) {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
});

// Marketing assets (OG image, etc.)
await app.register(fastifyStatic, {
  root: join(ROOT_DIR, 'assets'),
  prefix: '/assets/',
  decorateReply: false,
});

// Discovery files (SEO + LLM crawlers)
app.get('/robots.txt', async (_req, reply) => {
  const base = appBase(config.appUrl);
  return reply.type('text/plain; charset=utf-8').send(robotsTxt(base));
});

app.get('/sitemap.xml', async (_req, reply) => {
  const base = appBase(config.appUrl);
  return reply.type('application/xml; charset=utf-8').send(sitemapXml(base));
});

app.get('/llms.txt', async (_req, reply) => {
  const base = appBase(config.appUrl);
  return reply.type('text/plain; charset=utf-8').send(llmsTxt(base));
});

/** Partner API — marketer-safe URL header probe (growth stack / AI-CMO). */
app.get('/api/v1/url-check', async (req, reply) => {
  if (!urlCheckRateOk(req.ip || 'unknown')) return rateLimited(reply);
  const url = (req.query as { url?: string }).url?.trim();
  if (!url) {
    return reply.code(400).send({ error: 'url query parameter is required' });
  }
  try {
    const result = await summarizeUrlCheck(url);
    return reply.send(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'URL check failed';
    return reply.code(400).send({ error: message });
  }
});

// Marketing landing page at /
app.get('/', async (_req, reply) => {
  const base = appBase(config.appUrl);
  let html = readFileSync(join(ROOT_DIR, 'index.html'), 'utf8');
  html = injectLandingSeo(html, base);
  return reply.type('text/html').send(html);
});

// Legal pages
await app.register(fastifyStatic, {
  root: LEGAL_DIR,
  prefix: '/legal/',
  decorateReply: false,
});

app.get('/legal/terms', async (_req, reply) => {
  return reply.type('text/html').send(readFileSync(join(LEGAL_DIR, 'terms.html'), 'utf8'));
});

app.get('/legal/privacy', async (_req, reply) => {
  return reply.type('text/html').send(readFileSync(join(LEGAL_DIR, 'privacy.html'), 'utf8'));
});

app.get('/legal/cookies', async (_req, reply) => {
  return reply.type('text/html').send(readFileSync(join(LEGAL_DIR, 'cookies.html'), 'utf8'));
});

// Login / sign-up page
app.get('/login', async (_req, reply) => {
  return reply.sendFile('login.html', PUBLIC_DIR);
});

// Dashboard — requires GitHub session
app.get('/app', async (req, reply) => {
  if (!getSession(req)) return reply.redirect('/login');
  return reply.redirect('/app/');
});

app.get('/app/', async (req, reply) => {
  if (!getSession(req)) return reply.redirect('/login');
  return reply
    .header('Cache-Control', 'no-store, no-cache, must-revalidate')
    .sendFile('index.html', PUBLIC_DIR);
});

// Dashboard static assets at /app/* (JS, CSS — not index.html)
await app.register(fastifyStatic, {
  root: PUBLIC_DIR,
  prefix: '/app/',
  index: false,
});

// Preserve raw body for webhook signature verification
app.addHook('preParsing', async (request, _reply, payload) => {
  const path = request.url.split('?')[0];
  if (
    !path.startsWith('/api/webhooks/github') &&
    !path.startsWith('/api/billing/webhook') &&
    !path.startsWith('/api/partner/studio-billing')
  )
    return payload;

  const chunks: Buffer[] = [];
  for await (const chunk of payload) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks);
  (request as { rawBody?: string }).rawBody = raw.toString('utf8');
  return raw;
});

function dashboardUrl(scanId: string): string {
  return `${config.appUrl}/app/?scan=${scanId}`;
}

function resolveGithubToken(
  req: Parameters<typeof resolveToken>[0],
  body?: { githubToken?: string }
): string | undefined {
  const fromSession = resolveToken(req, req.headers['x-github-token'] as string | undefined, body?.githubToken);
  return fromSession ?? (config.github.token || undefined);
}

// ── Health ──

app.get('/api/health', async () => ({
  ok: true,
  appUrl: config.appUrl,
  production: !/localhost|127\.0\.0\.1/i.test(config.appUrl),
  contactEmail: config.contactEmail,
  modules: {
    code: true,
    cloud: true,
    attack: true,
    protect: true,
  },
  github: {
    oauth: oauthConfigured(),
    webhook: Boolean(config.github.webhookSecret),
    serverToken: Boolean(config.github.token),
  },
  ai: {
    configured: llmConfigured(),
    provider: llmConfigured() ? config.ai.provider : null,
    model: llmConfigured()
      ? config.ai.provider === 'openai'
        ? config.ai.openaiModel
        : config.ai.anthropicModel
      : null,
  },
  osv: { enabled: true },
  protect: protectStats(),
  billing: {
    stripe: stripeConfigured(),
    teamPriceMonthly: 29,
  },
  storage: dbConfigured() ? 'postgres' : 'file',
}));

app.addHook('preHandler', async (req, reply) => {
  const path = req.url.split('?')[0];
  if (
    path.startsWith('/api/auth') ||
    path.startsWith('/api/webhooks') ||
    path.startsWith('/api/billing/webhook') ||
    path.startsWith('/api/partner/studio-billing')
  ) {
    return;
  }
  if (!path.startsWith('/api/') && !path.startsWith('/app')) return;

  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
  let body = '';
  if (req.body !== undefined && req.body !== null) {
    body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }

  const event = evaluateProtectRequest(req.method, path, query, body);
  if (event) {
    return reply.status(403).send({
      error: 'Blocked by Aegis Loop Protect',
      ruleId: event.ruleId,
      detail: event.detail,
    });
  }
});

// ── Auth ──

app.get('/api/auth/me', async (req) => {
  const session = getSession(req);
  if (!session) return { connected: false };
  const account = getAccountForUser(session.login);
  return {
    connected: true,
    login: session.login,
    name: session.name,
    avatarUrl: session.avatarUrl,
    oauthAvailable: oauthConfigured(),
    plan: planSummary(account),
  };
});

app.get('/api/auth/github', async (_req, reply) => {
  if (!oauthConfigured()) {
    return reply.status(400).send({ error: 'GitHub OAuth not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.' });
  }
  return reply.redirect(startOAuth(reply));
});

function registerAuthenticatedUser(
  login: string,
  authMethod: 'oauth' | 'pat',
): void {
  const isNew = !accountExists(login);
  syncOwnerPlan(login);
  if (isNew) {
    emitUserSignup({ githubLogin: login, authMethod, email: null });
  }
}

app.get('/api/auth/github/callback', async (req, reply) => {
  const { code, state } = req.query as { code?: string; state?: string };
  if (!code || !state || !consumeOAuthState(req, reply, state)) {
    req.log.warn({ hasCode: Boolean(code), hasState: Boolean(state) }, 'GitHub OAuth state validation failed');
    return reply.redirect('/login?auth=failed');
  }

  try {
    const session = await exchangeCode(code);
    registerAuthenticatedUser(session.login, 'oauth');
    setSessionCookie(reply, session);
    return reply.redirect('/app/?auth=success');
  } catch (err) {
    req.log.error({ err }, 'GitHub OAuth token exchange failed');
    return reply.redirect('/login?auth=failed');
  }
});

app.post('/api/auth/pat', async (req, reply) => {
  if (!authRateOk(req.ip || 'unknown')) return rateLimited(reply);
  const { token } = req.body as { token?: string };
  if (!token?.trim()) {
    return reply.status(400).send({ error: 'token is required' });
  }

  try {
    const session = await sessionFromPat(token.trim());
    registerAuthenticatedUser(session.login, 'pat');
    setSessionCookie(reply, session);
    return { connected: true, login: session.login, avatarUrl: session.avatarUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid token';
    return reply.status(401).send({ error: message });
  }
});

app.post('/api/auth/logout', async (req, reply) => {
  clearSessionCookie(req, reply);
  return { ok: true };
});

// ── GitHub repos ──

app.get('/api/github/repos', async (req, reply) => {
  if (!requireSession(req, reply)) return;
  const token = resolveGithubToken(req);
  if (!token) return reply.status(401).send({ error: 'GitHub not connected' });
  return listUserRepos(token);
});

// ── Scans ──

app.get('/api/scans', async (req, reply) => {
  const auth = requireAuth(req, reply);
  if (!auth) return;
  return listScans('code', auth.login);
});

app.get('/api/scans/:id', async (req, reply) => {
  const auth = requireAuth(req, reply);
  if (!auth) return;
  const { id } = req.params as { id: string };
  const scan = getScan(id);
  if (!scan) return reply.status(404).send({ error: 'Scan not found' });
  if (scan.userLogin && scan.userLogin !== auth.login) {
    return reply.status(404).send({ error: 'Scan not found' });
  }
  return scan;
});

app.post('/api/scans/demo', async (req, reply) => {
  const auth = requireAuth(req, reply);
  if (!auth) return;
  const scan = tagScan(await scanDirectory(config.demoRepo, 'aegis-loop/sample-app', 'main'), auth.login);
  saveScan(scan);
  return scan;
});

app.post('/api/scans', async (req, reply) => {
  const auth = requireAuth(req, reply);
  if (!auth) return;
  if (!scanRateOk(auth.login)) return rateLimited(reply);
  const body = req.body as { repo?: string; branch?: string };
  if (!body.repo?.trim()) {
    return reply.status(400).send({ error: 'repo is required (owner/repo or GitHub URL)' });
  }

  const token = resolveGithubToken(req, body as { githubToken?: string });
  let tempDir: string | undefined;

  try {
    const parsed = parseRepoInput(body.repo);
    const repoName = `${parsed.owner}/${parsed.repo}`;
    const allowed = canScanRepo(auth.account, repoName);
    if (!allowed.ok) return planLimitReply(reply, allowed.reason);

    tempDir = await cloneRepo(parsed.owner, parsed.repo, body.branch ?? 'main', token);
    const scan = tagScan(
      await scanDirectory(tempDir, repoName, body.branch ?? 'main'),
      auth.login
    );
    saveScan(scan);
    return scan;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Scan failed';
    return reply.status(400).send({ error: message });
  } finally {
    if (tempDir) cleanupDir(tempDir);
  }
});

app.post('/api/scans/pull-request', async (req, reply) => {
  const auth = requireAuth(req, reply);
  if (!auth) return;
  if (!scanRateOk(auth.login)) return rateLimited(reply);
  const body = req.body as { pr?: string; owner?: string; repo?: string; pullNumber?: number; publish?: boolean };
  const token = resolveGithubToken(req, body as { githubToken?: string });

  let owner: string;
  let repo: string;
  let pullNumber: number;

  if (body.pr?.trim()) {
    const parsed = parsePrInput(body.pr);
    owner = parsed.owner;
    repo = parsed.repo;
    pullNumber = parsed.pullNumber;
  } else if (body.owner && body.repo && body.pullNumber) {
    owner = body.owner;
    repo = body.repo;
    pullNumber = body.pullNumber;
  } else {
    return reply.status(400).send({ error: 'Provide pr (URL or owner/repo#123) or owner/repo/pullNumber' });
  }

  const repoName = `${owner}/${repo}`;
  const allowed = canScanRepo(auth.account, repoName);
  if (!allowed.ok) return planLimitReply(reply, allowed.reason);

  let tempDir: string | undefined;

  try {
    const pr = await fetchPullRequest(token, owner, repo, pullNumber);
    tempDir = await clonePullRequest(owner, repo, pr.headBranch, token);
    const scan = tagScan(await scanDirectory(tempDir, repoName, pr.headBranch), auth.login);
    scan.pullRequest = pr;
    saveScan(scan);

    const shouldPublish = body.publish !== false && Boolean(token);
    if (shouldPublish && token) {
      const { commentUrl, statusUrl } = await publishScanToGitHub(token, scan, dashboardUrl(scan.id));
      updateScanMeta(scan.id, { githubCommentUrl: commentUrl, checkStatusUrl: statusUrl });
      scan.githubCommentUrl = commentUrl;
      scan.checkStatusUrl = statusUrl;
    }

    return scan;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'PR scan failed';
    return reply.status(400).send({ error: message });
  } finally {
    if (tempDir) cleanupDir(tempDir);
  }
});

app.post('/api/scans/:scanId/github/publish', async (req, reply) => {
  if (!requireSession(req, reply)) return;
  const { scanId } = req.params as { scanId: string };
  const token = resolveGithubToken(req);
  if (!token) return reply.status(401).send({ error: 'GitHub not connected' });

  const scan = getScan(scanId);
  if (!scan) return reply.status(404).send({ error: 'Scan not found' });
  if (!scan.pullRequest) {
    return reply.status(400).send({ error: 'This scan is not linked to a pull request' });
  }

  const { commentUrl, statusUrl } = await publishScanToGitHub(token, scan, dashboardUrl(scanId));
  updateScanMeta(scanId, { githubCommentUrl: commentUrl, checkStatusUrl: statusUrl });

  return { commentUrl, statusUrl, scan: getScan(scanId) };
});

app.post('/api/scans/:scanId/findings/:findingId/autofix/generate', async (req, reply) => {
  const auth = requireAuth(req, reply);
  if (!auth) return;
  const autofixBlock = assertAutofixAccess(auth.account.plan);
  if (autofixBlock) return planLimitReply(reply, autofixBlock);

  const { scanId, findingId } = req.params as { scanId: string; findingId: string };
  const scan = getScan(scanId);
  if (!scan) return reply.status(404).send({ error: 'Scan not found' });

  const finding = scan.findings.find((f) => f.id === findingId);
  if (!finding) return reply.status(404).send({ error: 'Finding not found' });
  if (finding.fixed) return reply.status(400).send({ error: 'Finding already fixed' });

  try {
    const token = resolveGithubToken(req);
    const autofix = await resolveAutofix(scan, finding, token);
    updateFinding(scanId, findingId, { autofix });
    return { autofix, aiGenerated: !finding.autofix };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Autofix generation failed';
    return reply.status(400).send({ error: message });
  }
});

app.post('/api/scans/:scanId/findings/:findingId/autofix', async (req, reply) => {
  const auth = requireAuth(req, reply);
  if (!auth) return;
  const autofixBlock = assertAutofixAccess(auth.account.plan);
  if (autofixBlock) return planLimitReply(reply, autofixBlock);

  const { scanId, findingId } = req.params as { scanId: string; findingId: string };
  const body = (req.body ?? {}) as { createPr?: boolean; githubToken?: string };

  const scan = getScan(scanId);
  if (!scan) return reply.status(404).send({ error: 'Scan not found' });

  const finding = scan.findings.find((f) => f.id === findingId);
  if (!finding) return reply.status(404).send({ error: 'Finding not found' });
  if (finding.fixed) return { finding, message: 'Already fixed' };

  const token = resolveGithubToken(req, body);
  const autofix = await resolveAutofix(scan, finding, token);
  updateFinding(scanId, findingId, { autofix });

  const activeFinding = getScan(scanId)?.findings.find((f) => f.id === findingId);
  if (!activeFinding?.autofix) {
    return reply.status(400).send({ error: 'No autofix available for this finding' });
  }

  let prUrl: string | undefined;
  let commitUrl: string | undefined;

  if (body.createPr !== false && token && !scan.repo.startsWith('aegis-loop/')) {
    const [owner, repo] = scan.repo.split('/');
    const commitMessage = `fix(security): ${finding.title}\n\nAutofix by Aegis Loop / code`;
    const prBody = `## Security autofix\n\n**Rule:** ${finding.ruleId}\n**Severity:** ${finding.severity}\n\n${finding.message}\n\n---\n*Generated by Aegis Loop / code*`;

    if (scan.pullRequest) {
      commitUrl = await pushAutofixToBranch({
        token,
        owner,
        repo,
        branch: scan.pullRequest.headBranch,
        filePath: finding.file,
        content: activeFinding.autofix.patchedFile,
        commitMessage,
      });
      prUrl = scan.pullRequest.url;

      const note = `🔧 **Autofix applied** — ${finding.title} in \`${finding.file}:${finding.line}\`\n\n[View commit](${commitUrl})`;
      await updateExistingBotComment(
        token,
        owner,
        repo,
        scan.pullRequest.number,
        `${note}\n\n---\n\n${formatPrComment(scan, dashboardUrl(scanId))}`
      );
    } else {
      prUrl = await createAutofixPr({
        token,
        owner,
        repo,
        baseBranch: scan.branch,
        filePath: finding.file,
        content: activeFinding.autofix.patchedFile,
        commitMessage,
        prTitle: `[Aegis Loop] ${finding.title}`,
        prBody,
      });
    }
  }

  const updated = updateFinding(scanId, findingId, {
    fixed: true,
    prUrl: prUrl ?? commitUrl,
    snippet: activeFinding.autofix.fixedLine,
  });

  return {
    finding: updated,
    prUrl: prUrl ?? commitUrl,
    patch: activeFinding.autofix.patchedFile,
    message: commitUrl
      ? 'Autofix pushed to PR branch'
      : prUrl
        ? 'Autofix PR opened on GitHub'
        : 'Finding marked fixed — connect GitHub to push autofix',
  };
});

// ── Cloud module ──

app.get('/api/cloud/scans', async (req, reply) => {
  const auth = requireAuth(req, reply);
  if (!auth) return;
  return listScans('cloud', auth.login);
});

app.get('/api/cloud/scans/:id', async (req, reply) => {
  const auth = requireAuth(req, reply);
  if (!auth) return;
  const { id } = req.params as { id: string };
  const scan = getScan(id);
  if (!scan || (scan.module ?? 'code') !== 'cloud') {
    return reply.status(404).send({ error: 'Cloud scan not found' });
  }
  if (scan.userLogin && scan.userLogin !== auth.login) {
    return reply.status(404).send({ error: 'Cloud scan not found' });
  }
  return scan;
});

app.post('/api/cloud/scans/demo', async (req, reply) => {
  const auth = requireAuth(req, reply);
  if (!auth) return;
  const moduleBlock = assertModuleAccess(auth.account.plan, 'cloud');
  if (moduleBlock) return planLimitReply(reply, moduleBlock);

  const scan = tagScan(
    await scanCloudDirectory(config.cloudDemoRepo, 'aegis-loop/cloud-demo', 'main'),
    auth.login
  );
  saveScan(scan);
  syncProtectRulesFromScans();
  return scan;
});

app.post('/api/cloud/scans', async (req, reply) => {
  const auth = requireAuth(req, reply);
  if (!auth) return;
  if (!scanRateOk(auth.login)) return rateLimited(reply);
  const moduleBlock = assertModuleAccess(auth.account.plan, 'cloud');
  if (moduleBlock) return planLimitReply(reply, moduleBlock);

  const body = req.body as { repo?: string; branch?: string };
  if (!body.repo?.trim()) {
    return reply.status(400).send({ error: 'repo is required (owner/repo or GitHub URL)' });
  }

  const token = resolveGithubToken(req);
  let tempDir: string | undefined;

  try {
    const parsed = parseRepoInput(body.repo);
    const repoName = `${parsed.owner}/${parsed.repo}`;
    const allowed = canScanRepo(auth.account, repoName);
    if (!allowed.ok) return planLimitReply(reply, allowed.reason);

    tempDir = await cloneRepo(parsed.owner, parsed.repo, body.branch ?? 'main', token);
    const scan = tagScan(
      await scanCloudDirectory(tempDir, repoName, body.branch ?? 'main'),
      auth.login
    );
    saveScan(scan);
    syncProtectRulesFromScans();
    return scan;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cloud scan failed';
    return reply.status(400).send({ error: message });
  } finally {
    if (tempDir) cleanupDir(tempDir);
  }
});

// ── Attack module ──

app.get('/api/attack/scans', async (req, reply) => {
  const auth = requireAuth(req, reply);
  if (!auth) return;
  return listScans('attack', auth.login);
});

app.get('/api/attack/scans/:id', async (req, reply) => {
  const auth = requireAuth(req, reply);
  if (!auth) return;
  const { id } = req.params as { id: string };
  const scan = getScan(id);
  if (!scan || scan.module !== 'attack') {
    return reply.status(404).send({ error: 'Attack scan not found' });
  }
  if (scan.userLogin && scan.userLogin !== auth.login) {
    return reply.status(404).send({ error: 'Attack scan not found' });
  }
  return scan;
});

app.post('/api/attack/scans', async (req, reply) => {
  const auth = requireAuth(req, reply);
  if (!auth) return;
  if (!scanRateOk(auth.login)) return rateLimited(reply);
  const moduleBlock = assertModuleAccess(auth.account.plan, 'attack');
  if (moduleBlock) return planLimitReply(reply, moduleBlock);

  const body = req.body as { target?: string; url?: string; targets?: string[] };
  const multi = body.targets?.length
    ? body.targets
    : undefined;
  const single = body.target?.trim() || body.url?.trim();

  try {
    if (multi?.length) {
      const scans = (await scanAttackTargets(multi)).map((s) => tagScan(s, auth.login));
      for (const scan of scans) saveScan(scan);
      syncProtectRulesFromScans();
      return { scans, count: scans.length };
    }
    if (!single) {
      return reply.status(400).send({ error: 'target, url, or targets[] is required' });
    }
    const scan = tagScan(await scanAttackTarget(single), auth.login);
    saveScan(scan);
    syncProtectRulesFromScans();
    return scan;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Attack probe failed';
    return reply.status(400).send({ error: message });
  }
});

// ── CI (API key) ──

app.post('/api/ci/scan', async (req, reply) => {
  const auth = requireAuth(req, reply);
  if (!auth) return;
  if (auth.via !== 'apiKey') {
    return reply.status(403).send({ error: 'CI scans require an API key (Authorization: Bearer aegis_…)' });
  }
  if (!scanRateOk(auth.login)) return rateLimited(reply);

  const body = req.body as { repo?: string; pr?: number; branch?: string };
  if (!body.repo?.trim()) {
    return reply.status(400).send({ error: 'repo is required (owner/repo)' });
  }

  const token = config.github.token;
  if (!token) {
    return reply.status(503).send({ error: 'Server GITHUB_TOKEN not configured for CI scans' });
  }

  const [owner, repo] = body.repo.split('/');
  if (!owner || !repo) {
    return reply.status(400).send({ error: 'repo must be owner/repo' });
  }

  const repoName = `${owner}/${repo}`;
  const allowed = canScanRepo(auth.account, repoName);
  if (!allowed.ok) return planLimitReply(reply, allowed.reason);

  let tempDir: string | undefined;
  try {
    if (body.pr) {
      const pr = await fetchPullRequest(token, owner, repo, body.pr);
      tempDir = await clonePullRequest(owner, repo, pr.headBranch, token);
      const scan = tagScan(await scanDirectory(tempDir, repoName, pr.headBranch), auth.login);
      scan.pullRequest = pr;
      saveScan(scan);
      const { commentUrl, statusUrl } = await publishScanToGitHub(token, scan, dashboardUrl(scan.id));
      updateScanMeta(scan.id, { githubCommentUrl: commentUrl, checkStatusUrl: statusUrl });
      return { scanId: scan.id, findings: scan.findings.length, score: scan.stats.score, commentUrl };
    }

    tempDir = await cloneRepo(owner, repo, body.branch ?? 'main', token);
    const scan = tagScan(await scanDirectory(tempDir, repoName, body.branch ?? 'main'), auth.login);
    saveScan(scan);
    return { scanId: scan.id, findings: scan.findings.length, score: scan.stats.score };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'CI scan failed';
    return reply.status(400).send({ error: message });
  } finally {
    if (tempDir) cleanupDir(tempDir);
  }
});

// ── Billing & API keys ──

app.get('/api/billing/plan', async (req, reply) => {
  const auth = requireAuth(req, reply);
  if (!auth) return;
  const account = auth.account;
  return {
    ...planSummary(account),
    stripe: stripeConfigured(),
    apiKeys: account.apiKeys.map((k) => ({
      id: k.id,
      label: k.label,
      prefix: k.prefix,
      createdAt: k.createdAt,
    })),
  };
});

app.post('/api/billing/checkout', async (req, reply) => {
  const auth = requireAuth(req, reply);
  if (!auth) return;
  if (!stripeConfigured()) {
    return reply.status(503).send({ error: 'Stripe billing is not configured on this server' });
  }
  const body = (req.body ?? {}) as { seats?: number };
  const url = await createCheckoutSession(auth.login, body.seats ?? 1);
  if (!url) return reply.status(503).send({ error: 'Could not create checkout session' });
  return { url };
});

app.post('/api/billing/sync', async (req, reply) => {
  const auth = requireAuth(req, reply);
  if (!auth) return;
  if (!stripeConfigured()) {
    return reply.status(503).send({ error: 'Stripe billing is not configured on this server' });
  }
  try {
    const account = await syncBillingFromStripe(auth.login);
    return { ...planSummary(account), stripe: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not sync billing';
    return reply.status(500).send({ error: message });
  }
});

app.post('/api/billing/portal', async (req, reply) => {
  const auth = requireAuth(req, reply);
  if (!auth) return;
  const url = await createBillingPortalSession(auth.login);
  if (!url) return reply.status(400).send({ error: 'No billing account — subscribe to Team first' });
  return { url };
});

app.post('/api/partner/studio-billing', async (req, reply) => {
  const rawBody = (req as { rawBody?: string }).rawBody ?? '';
  const signature = req.headers['x-studio-billing-signature'] as string | undefined;
  if (!verifyStudioBillingSignature(rawBody, signature)) {
    return reply.status(401).send({ error: 'Invalid signature' });
  }
  let event: StudioBillingPartnerEvent;
  try {
    event = JSON.parse(rawBody) as StudioBillingPartnerEvent;
  } catch {
    return reply.status(400).send({ error: 'Invalid JSON' });
  }
  const result = handleStudioBillingPartnerEvent(event);
  if (!result.ok && result.error && result.error !== 'skipped') {
    return reply.status(result.error.includes('GitHub') ? 404 : 400).send({ error: result.error });
  }
  return result;
});

app.post('/api/billing/webhook', async (req, reply) => {
  const rawBody = (req as { rawBody?: string }).rawBody ?? '';
  const signature = req.headers['stripe-signature'] as string | undefined;
  if (!signature) return reply.status(400).send({ error: 'Missing stripe-signature' });
  try {
    await handleStripeWebhook(rawBody, signature);
    return { received: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook error';
    return reply.status(400).send({ error: message });
  }
});

app.post('/api/keys', async (req, reply) => {
  const auth = requireAuth(req, reply);
  if (!auth) return;
  if (auth.via === 'apiKey') {
    return reply.status(403).send({ error: 'Create API keys from the dashboard while signed in' });
  }
  const body = (req.body ?? {}) as { label?: string };
  const { key, record } = createApiKey(auth.login, body.label?.trim() || 'CI');
  return {
    key,
    record: { id: record.id, label: record.label, prefix: record.prefix, createdAt: record.createdAt },
    message: 'Copy this key now — it will not be shown again.',
  };
});

app.delete('/api/keys/:id', async (req, reply) => {
  const auth = requireAuth(req, reply);
  if (!auth) return;
  const { id } = req.params as { id: string };
  if (!revokeApiKey(auth.login, id)) {
    return reply.status(404).send({ error: 'API key not found' });
  }
  return { ok: true };
});

app.get('/api/protect/rules/export', async (req, reply) => {
  if (!requireSession(req, reply)) return;
  const rules = listProtectRules();
  reply.header('Content-Type', 'application/json');
  reply.header('Content-Disposition', 'attachment; filename="aegis-protect-rules.json"');
  return {
    exportedAt: new Date().toISOString(),
    rules: rules.map((r) => ({
      id: r.id,
      title: r.title,
      source: r.source,
      pattern: r.pattern,
      description: r.description,
      enabled: r.enabled,
      findingRuleId: r.findingRuleId,
    })),
  };
});

// ── Protect module ──

app.get('/api/protect/rules', async (req, reply) => {
  if (!requireSession(req, reply)) return;
  return { rules: listProtectRules(), stats: protectStats() };
});

app.get('/api/protect/events', async (req, reply) => {
  if (!requireSession(req, reply)) return;
  return { events: listProtectEvents() };
});

app.post('/api/protect/sync', async (req, reply) => {
  if (!requireSession(req, reply)) return;
  const rules = syncProtectRulesFromScans();
  return { rules, stats: protectStats() };
});

app.patch('/api/protect/rules/:id', async (req, reply) => {
  if (!requireSession(req, reply)) return;
  const { id } = req.params as { id: string };
  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== 'boolean') {
    return reply.status(400).send({ error: 'enabled (boolean) is required' });
  }
  const rule = setProtectRuleEnabled(id, enabled);
  if (!rule) return reply.status(404).send({ error: 'Rule not found' });
  return { rule, stats: protectStats() };
});

app.post('/api/protect/demo', async (req, reply) => {
  if (!requireSession(req, reply)) return;
  const body = req.body as { payload?: string };
  const payload = body.payload ?? "' OR 1=1 --";
  const event = evaluateProtectRequest('POST', '/api/protect/demo', '', payload);
  if (event) {
    return reply.status(403).send({ blocked: true, event, stats: protectStats() });
  }
  return { blocked: false, message: 'Payload allowed — no active rule matched', stats: protectStats() };
});

// ── Webhooks ──

app.post('/api/webhooks/github', async (req, reply) => {
  const rawBody = (req as { rawBody?: string }).rawBody ?? JSON.stringify(req.body);
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const event = req.headers['x-github-event'] as string | undefined;

  try {
    const result = await handleGitHubWebhook(rawBody, signature, event);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook error';
    return reply.status(400).send({ error: message });
  }
});

app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api/')) {
    return reply.status(404).send({ error: 'Not found' });
  }
  if (req.url.startsWith('/app')) {
    return reply.sendFile('index.html', PUBLIC_DIR);
  }
  return reply.redirect('/');
});

await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`\n  Aegis Loop → ${config.appUrl}`);
console.log(`  Login      → ${config.appUrl}/login`);
console.log(`  Dashboard  → ${config.appUrl}/app\n`);
