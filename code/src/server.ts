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

loadStore();
loadProtectStore();

await app.register(fastifyCookie, { secret: config.sessionSecret });
await app.register(cors, { origin: true });

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
  return reply.sendFile('index.html', PUBLIC_DIR);
});

// Dashboard static assets at /app/* (JS, CSS — not index.html)
await app.register(fastifyStatic, {
  root: PUBLIC_DIR,
  prefix: '/app/',
  index: false,
});

// Preserve raw body for webhook signature verification
app.addHook('preParsing', async (request, _reply, payload) => {
  if (!request.url.startsWith('/api/webhooks/github')) return payload;

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
}));

app.addHook('preHandler', async (req, reply) => {
  const path = req.url.split('?')[0];
  if (path.startsWith('/api/auth') || path.startsWith('/api/webhooks')) return;
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
  return {
    connected: true,
    login: session.login,
    name: session.name,
    avatarUrl: session.avatarUrl,
    oauthAvailable: oauthConfigured(),
  };
});

app.get('/api/auth/github', async (_req, reply) => {
  if (!oauthConfigured()) {
    return reply.status(400).send({ error: 'GitHub OAuth not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.' });
  }
  return reply.redirect(startOAuth(reply));
});

app.get('/api/auth/github/callback', async (req, reply) => {
  const { code, state } = req.query as { code?: string; state?: string };
  if (!code || !state || !consumeOAuthState(req, reply, state)) {
    req.log.warn({ hasCode: Boolean(code), hasState: Boolean(state) }, 'GitHub OAuth state validation failed');
    return reply.redirect('/login?auth=failed');
  }

  try {
    const session = await exchangeCode(code);
    setSessionCookie(reply, session);
    return reply.redirect('/app/?auth=success');
  } catch (err) {
    req.log.error({ err }, 'GitHub OAuth token exchange failed');
    return reply.redirect('/login?auth=failed');
  }
});

app.post('/api/auth/pat', async (req, reply) => {
  const { token } = req.body as { token?: string };
  if (!token?.trim()) {
    return reply.status(400).send({ error: 'token is required' });
  }

  try {
    const session = await sessionFromPat(token.trim());
    setSessionCookie(reply, session);
    return { connected: true, login: session.login, avatarUrl: session.avatarUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid token';
    return reply.status(401).send({ error: message });
  }
});

app.post('/api/auth/logout', async (_req, reply) => {
  clearSessionCookie(reply);
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
  if (!requireSession(req, reply)) return;
  return listScans('code');
});

app.get('/api/scans/:id', async (req, reply) => {
  if (!requireSession(req, reply)) return;
  const { id } = req.params as { id: string };
  const scan = getScan(id);
  if (!scan) return reply.status(404).send({ error: 'Scan not found' });
  return scan;
});

app.post('/api/scans/demo', async (req, reply) => {
  if (!requireSession(req, reply)) return;
  const scan = await scanDirectory(config.demoRepo, 'aegis-loop/sample-app', 'main');
  saveScan(scan);
  return scan;
});

app.post('/api/scans', async (req, reply) => {
  if (!requireSession(req, reply)) return;
  const body = req.body as { repo?: string; branch?: string };
  if (!body.repo?.trim()) {
    return reply.status(400).send({ error: 'repo is required (owner/repo or GitHub URL)' });
  }

  const token = resolveGithubToken(req);
  let tempDir: string | undefined;

  try {
    const parsed = parseRepoInput(body.repo);
    tempDir = await cloneRepo(parsed.owner, parsed.repo, body.branch ?? 'main', token);
    const scan = await scanDirectory(tempDir, `${parsed.owner}/${parsed.repo}`, body.branch ?? 'main');
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
  if (!requireSession(req, reply)) return;
  const body = req.body as { pr?: string; owner?: string; repo?: string; pullNumber?: number; publish?: boolean };
  const token = resolveGithubToken(req);

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

  let tempDir: string | undefined;

  try {
    const pr = await fetchPullRequest(token, owner, repo, pullNumber);
    tempDir = await clonePullRequest(owner, repo, pr.headBranch, token);
    const scan = await scanDirectory(tempDir, `${owner}/${repo}`, pr.headBranch);
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
  if (!requireSession(req, reply)) return;
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
  if (!requireSession(req, reply)) return;
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
  if (!requireSession(req, reply)) return;
  return listScans('cloud');
});

app.get('/api/cloud/scans/:id', async (req, reply) => {
  if (!requireSession(req, reply)) return;
  const { id } = req.params as { id: string };
  const scan = getScan(id);
  if (!scan || (scan.module ?? 'code') !== 'cloud') {
    return reply.status(404).send({ error: 'Cloud scan not found' });
  }
  return scan;
});

app.post('/api/cloud/scans/demo', async (req, reply) => {
  if (!requireSession(req, reply)) return;
  const scan = await scanCloudDirectory(config.cloudDemoRepo, 'aegis-loop/cloud-demo', 'main');
  saveScan(scan);
  syncProtectRulesFromScans();
  return scan;
});

app.post('/api/cloud/scans', async (req, reply) => {
  if (!requireSession(req, reply)) return;
  const body = req.body as { repo?: string; branch?: string };
  if (!body.repo?.trim()) {
    return reply.status(400).send({ error: 'repo is required (owner/repo or GitHub URL)' });
  }

  const token = resolveGithubToken(req);
  let tempDir: string | undefined;

  try {
    const parsed = parseRepoInput(body.repo);
    tempDir = await cloneRepo(parsed.owner, parsed.repo, body.branch ?? 'main', token);
    const scan = await scanCloudDirectory(tempDir, `${parsed.owner}/${parsed.repo}`, body.branch ?? 'main');
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
  if (!requireSession(req, reply)) return;
  return listScans('attack');
});

app.get('/api/attack/scans/:id', async (req, reply) => {
  if (!requireSession(req, reply)) return;
  const { id } = req.params as { id: string };
  const scan = getScan(id);
  if (!scan || scan.module !== 'attack') {
    return reply.status(404).send({ error: 'Attack scan not found' });
  }
  return scan;
});

app.post('/api/attack/scans', async (req, reply) => {
  if (!requireSession(req, reply)) return;
  const body = req.body as { target?: string; url?: string; targets?: string[] };
  const multi = body.targets?.length
    ? body.targets
    : undefined;
  const single = body.target?.trim() || body.url?.trim();

  try {
    if (multi?.length) {
      const scans = await scanAttackTargets(multi);
      for (const scan of scans) saveScan(scan);
      syncProtectRulesFromScans();
      return { scans, count: scans.length };
    }
    if (!single) {
      return reply.status(400).send({ error: 'target, url, or targets[] is required' });
    }
    const scan = await scanAttackTarget(single);
    saveScan(scan);
    syncProtectRulesFromScans();
    return scan;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Attack probe failed';
    return reply.status(400).send({ error: message });
  }
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
