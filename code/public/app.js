const API = window.location.origin;

let currentScan = null;
let activeFinding = null;
let githubUser = null;
let allFindings = [];
let allRepos = [];
let repoScanMap = {};
let allScansCache = [];
let currentView = 'feed';
let llmAvailable = false;
let issuesModalRepo = null;
let bulkScanning = false;
let panelAiGenerated = false;
let healthInfo = null;

const DEMO_REPO = 'aegis-loop/sample-app';
const CLOUD_DEMO_REPO = 'aegis-loop/cloud-demo';

const SCANNER_ENGINES = [
  { id: 'secrets', title: 'Secret detection', desc: 'AWS keys, API tokens, passwords, and high-entropy strings in source.', always: true },
  { id: 'sqli', title: 'SQL injection', desc: 'String interpolation and unsafe query construction in application code.', always: true },
  { id: 'eval', title: 'Unsafe execution', desc: 'Dynamic eval and similar patterns that enable remote code execution.', always: true },
  { id: 'osv', title: 'Dependency scanning (OSV)', desc: 'Live lookup against the OSV database for vulnerable npm packages.', healthKey: 'osv' },
  { id: 'ai', title: 'AI remediation', desc: 'LLM-generated patches when templates do not cover a finding.', healthKey: 'ai' },
];

const DOC_SECTIONS = [
  {
    id: 'quickstart',
    title: 'Quick start',
    keywords: 'start scan connect github login',
    html: `<p>Sign in with GitHub, open <strong>Repositories</strong>, and click <strong>Scan</strong> on any repo — or use <strong>+ New scan</strong> for a single repo, bulk scan, or pull request.</p>
      <ul><li><strong>Repositories</strong> — browse and scan all GitHub repos you can access</li>
      <li><strong>+ New scan</strong> — single repo, all repos, or PR scan</li>
      <li><strong>A-Fix</strong> — open autofix panel for the first open finding</li></ul>`,
  },
  {
    id: 'overview',
    title: 'Overview',
    keywords: 'overview dashboard kpi charts score workspace findings severity remediation home',
    html: `<p><strong>What it is:</strong> The home screen of the Code module — your security command center. Before your first scan you see a getting-started hero; after scanning, KPI cards and four chart panels summarize every repository you have scanned.</p>
      <h4 style="margin:16px 0 8px;font-size:13px">The four-step workflow</h4>
      <ol><li><strong>First scan</strong> — demo scan or + New scan; charts stay empty until then</li>
      <li><strong>KPI strip</strong> — Critical, High, Fixed, Security score, Repos scanned</li>
      <li><strong>Charts</strong> — severity bars, score ring, repo coverage, remediation progress</li>
      <li><strong>Take action</strong> — open Findings or A-Fix queue from the sidebar</li></ol>
      <h4 style="margin:16px 0 8px;font-size:13px">Workspace scope</h4>
      <p>Overview uses the <strong>latest scan per repository</strong> — not every historical run. The label <em>Workspace · latest scan per repo</em> on the KPI strip confirms this. Sidebar stats (Repos, Open, Avg score) use the same rollup.</p>
      <h4 style="margin:16px 0 8px;font-size:13px">Chart panels</h4>
      <ul><li><strong>Findings by severity</strong> — open critical, high, and info counts</li>
      <li><strong>Security score</strong> — workspace average 0–100 (higher is better)</li>
      <li><strong>Repository coverage</strong> — which repos have the most open findings</li>
      <li><strong>Remediation progress</strong> — fixed vs open findings across the workspace</li></ul>
      <h4 style="margin:16px 0 8px;font-size:13px">Overview vs other views</h4>
      <ul><li><strong>Findings</strong> — full searchable list with file paths and A-Fix buttons</li>
      <li><strong>A-Fix queue</strong> — only findings with a template or AI fix available</li>
      <li><strong>Repositories</strong> — browse GitHub and trigger scans</li>
      <li><strong>Cloud / Attack / Protect</strong> — other modules via the pill switcher</li></ul>
      <h4 style="margin:16px 0 8px;font-size:13px">Common questions</h4>
      <ul><li><strong>Mock data?</strong> No — numbers come from scans you ran.</li>
      <li><strong>Score gone after idle?</strong> Workspace may sleep; rescan to repopulate.</li>
      <li><strong>Critical 0 but chart has bars?</strong> High KPI = scanner “warning” severity (e.g. dependencies).</li></ul>`,
  },
  {
    id: 'scanning',
    title: 'Scanning',
    keywords: 'scan repository branch pull request pr bulk osv secrets',
    html: `<p>Scans clone the target branch and run static rules plus OSV dependency lookup.</p>
      <ul><li><strong>Single repo</strong> — <code>owner/repo</code> + branch (default <code>main</code>)</li>
      <li><strong>All repos</strong> — sequential scan of every accessible repository</li>
      <li><strong>Pull request</strong> — <code>owner/repo#123</code> or PR URL; optional comment + check</li></ul>
      <p>Rules: exposed secrets, SQL injection patterns, dynamic code execution (<code>unsafe-eval</code>), vulnerable npm packages.</p>`,
  },
  {
    id: 'autofix',
    title: 'A-Fix',
    keywords: 'autofix ai fix apply patch llm remediate',
    html: `<p>Click <strong>A-Fix</strong> on any finding to open the remediation panel. Template fixes apply for secrets and dependencies; AI-generated fixes require <code>ANTHROPIC_API_KEY</code> or <code>OPENAI_API_KEY</code> on the server.</p>
      <p>Always review the diff before applying. Autofix can open a GitHub pull request when scanning real repos.</p>`,
  },
  {
    id: 'github',
    title: 'GitHub integration',
    keywords: 'oauth pat token webhook comment check connect auth',
    html: `<p>Connect via OAuth at <a href="/login">/login</a> or paste a personal access token in Settings. The token needs <code>repo</code> scope for private repositories.</p>
      <p>PR scans can post a markdown summary comment and a <code>aegis-loop/code</code> commit check. Webhooks auto-scan on pull request events when configured on the server.</p>`,
  },
  {
    id: 'api',
    title: 'API reference',
    keywords: 'api endpoint health scans autofix rest',
    html: `<ul>
      <li><code>GET /api/health</code> — server status</li>
      <li><code>GET /api/auth/me</code> — current session</li>
      <li><code>GET /api/github/repos</code> — list repositories</li>
      <li><code>POST /api/scans</code> — scan <code>{ repo, branch }</code></li>
      <li><code>POST /api/scans/pull-request</code> — scan PR</li>
      <li><code>POST /api/scans/:id/findings/:fid/autofix</code> — apply fix</li>
    </ul>`,
  },
  {
    id: 'performance',
    title: 'Slow first load?',
    keywords: 'slow sleep hibernate idle cold start wake performance',
    html: `<p><strong>The loop sleeps.</strong> This workspace powers down when nobody is using it — less waste, zero cost surprises.</p>
      <p>After idle time, your first visit may take ~30 seconds while scanners wake up. Refreshing or navigating again is instant once we're warm.</p>
      <p>Long sleeps can also clear locally stored scan history. Connect GitHub and rescan anytime.</p>`,
  },
  {
    id: 'cloud',
    title: 'Cloud module',
    keywords: 'cloud terraform kubernetes docker iac posture s3 security group aws gcp azure loadbalancer',
    html: `<p><strong>What it is:</strong> Scans infrastructure-as-code in your GitHub repo for accidental internet exposure — public S3/GCS buckets, security groups open to <code>0.0.0.0/0</code>, wildcard IAM, public Kubernetes LoadBalancers, Docker ports on all interfaces. No cloud provider credentials required.</p>
      <h4 style="margin:16px 0 8px;font-size:13px">The four-step workflow</h4>
      <ol><li><strong>Demo scan</strong> — click Run demo scan for instant sample findings (bundled Terraform/K8s/Docker fixtures)</li>
      <li><strong>Scan a repo</strong> — enter <code>owner/repo</code> + branch; we clone and scan all IaC files</li>
      <li><strong>Fix in IaC</strong> — open file:line from each finding; restrict CIDRs, ACLs, and IAM actions</li>
      <li><strong>Sync to Protect</strong> — derived WAF rules (e.g. metadata SSRF blocking) from cloud findings</li></ol>
      <h4 style="margin:16px 0 8px;font-size:13px">Rules we detect</h4>
      <ul><li><code>cloud/s3-public-acl</code> — public-read ACLs, BlockPublicAcls disabled</li>
      <li><code>cloud/sg-open-world</code> — ingress from 0.0.0.0/0 or ::/0</li>
      <li><code>cloud/iam-wildcard</code> — IAM Action: "*"</li>
      <li><code>cloud/k8s-public-lb</code> — Service type LoadBalancer</li>
      <li><code>cloud/docker-exposed-port</code> — 0.0.0.0:port bindings</li>
      <li><code>cloud/gcp-public-bucket</code> — allUsers / allAuthenticatedUsers</li>
      <li><code>cloud/azure-open-nsg</code> — NSG source_address_prefix "*"</li></ul>
      <h4 style="margin:16px 0 8px;font-size:13px">Cloud vs Code</h4>
      <p>Code scans application source (JS, Python, etc.) for bugs and secrets. Cloud scans <em>infra definitions</em> — the layer that decides who on the internet reaches your storage and ports. Run both before shipping.</p>
      <h4 style="margin:16px 0 8px;font-size:13px">Common questions</h4>
      <ul><li><strong>No findings?</strong> Repo may lack IaC files or infra lives elsewhere — try the demo scan first.</li>
      <li><strong>LoadBalancer warning?</strong> Not always wrong — confirm intent, add network policies.</li>
      <li><strong>Live AWS scan?</strong> Not yet — we read git, not cloud APIs.</li></ul>`,
  },
  {
    id: 'attack',
    title: 'Attack module',
    keywords: 'attack probe url headers https hsts csp x-frame surface offensive pentest nginx cdn',
    html: `<p><strong>What it is:</strong> Sends one safe GET request to a URL you authorize and evaluates the live response — HTTPS enforcement, security headers (HSTS, CSP, X-Frame-Options, X-Content-Type-Options), server disclosure, and HTTP error responses. Not a penetration test.</p>
      <h4 style="margin:16px 0 8px;font-size:13px">The four-step workflow</h4>
      <ol><li><strong>Pick a URL you control</strong> — staging or production; never third-party sites</li>
      <li><strong>Run probe</strong> — single GET, redirects followed, 12s timeout</li>
      <li><strong>Fix headers/HTTPS</strong> — configure CDN, nginx, CloudFront, Vercel, etc.</li>
      <li><strong>Sync to Protect</strong> — HTTP downgrade findings can add cleartext URL blocking rules</li></ol>
      <h4 style="margin:16px 0 8px;font-size:13px">Finding types</h4>
      <ul><li><code>attack/plain-http</code> — Critical — site responds over HTTP</li>
      <li><code>attack/missing-hsts</code> — High — no Strict-Transport-Security</li>
      <li><code>attack/missing-csp</code> — High — no Content-Security-Policy</li>
      <li><code>attack/missing-xfo</code> — Info — no X-Frame-Options</li>
      <li><code>attack/missing-xcto</code> — Info — no X-Content-Type-Options</li>
      <li><code>attack/server-disclosure</code> — Info — verbose Server header</li>
      <li><code>attack/error-leak</code> — High — HTTP 5xx response</li></ul>
      <h4 style="margin:16px 0 8px;font-size:13px">Example nginx headers</h4>
      <ul><li><code>add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;</code></li>
      <li><code>add_header Content-Security-Policy "default-src 'self';" always;</code></li>
      <li><code>return 301 https://$host$request_uri;</code> for HTTP → HTTPS redirect</li></ul>
      <h4 style="margin:16px 0 8px;font-size:13px">Limitations</h4>
      <ul><li>Cannot probe localhost — server runs in the cloud</li>
      <li>One request per probe — no crawling or auth testing</li>
      <li>Some WAFs may block user-agent <code>AegisLoop-Attack/1.0</code></li></ul>`,
  },
  {
    id: 'protect',
    title: 'Protect module',
    keywords: 'protect waf firewall block sqli xss runtime rules ssrf metadata sync toggle',
    html: `<p><strong>What it is:</strong> A web application firewall (WAF) that blocks attack patterns in incoming HTTP requests — SQL injection, XSS, path traversal — plus optional rules derived from your Code, Cloud, and Attack findings.</p>
      <h4 style="margin:16px 0 8px;font-size:13px">The four-step workflow</h4>
      <ol><li><strong>Scan first</strong> — Code, Cloud, and Attack findings enable smarter derived rules</li>
      <li><strong>Sync rules</strong> — merges built-ins + finding mappings; re-sync after new scans</li>
      <li><strong>Toggle rules</strong> — disable any rule causing false positives</li>
      <li><strong>Test block</strong> — Test block (SQLi) sends a harmless payload; check Block log</li></ol>
      <h4 style="margin:16px 0 8px;font-size:13px">Built-in rules</h4>
      <ul><li><strong>SQLi</strong> — <code>UNION SELECT</code>, <code>OR 1=1</code></li>
      <li><strong>XSS</strong> — <code>&lt;script</code>, <code>javascript:</code></li>
      <li><strong>Traversal</strong> — <code>../</code> sequences</li></ul>
      <h4 style="margin:16px 0 8px;font-size:13px">Derived rules (after sync)</h4>
      <ul><li>Code secrets → block AWS key patterns in requests</li>
      <li>Code SQLi → block injection payloads</li>
      <li>Cloud open SG → block metadata SSRF (<code>169.254.169.254</code>)</li>
      <li>Attack plain HTTP → block cleartext URL patterns</li></ul>
      <h4 style="margin:16px 0 8px;font-size:13px">Live on this dashboard</h4>
      <p>Protect middleware runs on <code>/app</code> and <code>/api</code> — malicious query strings are blocked with HTTP 403 and logged. In production, replicate patterns at Cloudflare WAF, AWS WAF, or nginx.</p>
      <h4 style="margin:16px 0 8px;font-size:13px">Important</h4>
      <p>WAF is a safety net, not a substitute for fixing Code findings or tightening IaC. Always fix root causes; Protect catches automated probes that slip through.</p>`,
  },
];

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const THEME_KEY = 'aegis-theme';

function getTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  localStorage.setItem(THEME_KEY, theme);
  updateThemeLabels();
}

function updateThemeLabels() {
  const label = getTheme() === 'dark' ? 'Dark' : 'Light';
  const el = $('#settingsThemeLabel');
  if (el) el.textContent = label;
}

function toggleTheme() {
  applyTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

function initTheme() {
  updateThemeLabels();
  $('#themeToggle')?.addEventListener('click', toggleTheme);
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4500);
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${API}${path}`, {
    credentials: 'include',
    headers,
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || 'Request failed');
  return data;
}

function sevClass(sev) {
  return sev === 'critical' ? 'sev-critical' : sev === 'warning' ? 'sev-warning' : 'sev-info';
}

function sevLabel(sev) {
  return sev === 'critical' ? 'Critical' : sev === 'warning' ? 'High' : 'Info';
}

function fileType(file) {
  const ext = file.split('.').pop()?.toLowerCase() ?? '?';
  if (ext === 'json') return { label: '{}', cls: 'json' };
  if (['ts', 'tsx'].includes(ext)) return { label: 'TS', cls: '' };
  if (['js', 'jsx'].includes(ext)) return { label: 'JS', cls: '' };
  return { label: ext.slice(0, 3).toUpperCase(), cls: '' };
}

function moduleBadge(mod) {
  if (mod === 'cloud') return { label: 'Cloud', cls: 'cloud' };
  if (mod === 'attack') return { label: 'Attack', cls: 'attack' };
  return null;
}

function hasRealCodeScan() {
  return Object.values(repoScanMap).some(
    (s) => s.status === 'complete' && s.repo && s.repo !== DEMO_REPO
  );
}

function isProductionDeploy() {
  return Boolean(healthInfo?.production);
}

function shouldShowCodeDemo() {
  if (hasRealCodeScan()) return false;
  if (isProductionDeploy()) return false;
  return true;
}

function codeScanEmptyMsg(short = false) {
  if (shouldShowCodeDemo()) {
    return short
      ? 'Run a demo or repository scan'
      : 'No findings yet. Run the demo scan or scan a repository to get started.';
  }
  return short
    ? 'Scan a repository or pull request'
    : 'No findings yet. Use + New scan to scan a repository or pull request.';
}

function chartEmptyMsg() {
  return shouldShowCodeDemo()
    ? 'Run a demo scan to populate severity breakdown'
    : 'Run + New scan to populate severity breakdown';
}

function scanHistoryEmptyMsg() {
  return shouldShowCodeDemo()
    ? 'No scans yet — run the demo'
    : 'No scans yet — use + New scan';
}

function updateDemoUi() {
  const showCodeDemo = shouldShowCodeDemo();
  const demoBtn = $('#homeDemoBtn');
  const scanBtn = $('#homeScanBtn');
  const demoNote = $('#homeDemoNote');
  const prodNote = $('#homeProdNote');

  demoBtn?.classList.toggle('hidden', !showCodeDemo);
  demoNote?.classList.toggle('hidden', !showCodeDemo);
  prodNote?.classList.toggle('hidden', showCodeDemo || !isProductionDeploy());

  if (scanBtn) {
    scanBtn.classList.toggle('btn-primary', !showCodeDemo);
    scanBtn.classList.toggle('btn-outline', showCodeDemo);
  }

  $('#homeChecklist [data-step="demo"]')?.classList.toggle('hidden', !showCodeDemo);
  $('#overviewGuideSteps [data-step="demo"]')?.classList.toggle('hidden', !showCodeDemo);

  const previewNote = $('#homePreviewNote');
  if (previewNote) {
    previewNote.textContent = showCodeDemo
      ? 'Run the demo to see live results — ranked like this in your security feed.'
      : 'Example output — your findings will look like this after your first scan.';
  }

  const guideBeforeScan = $('#overviewGuideBeforeScan');
  if (guideBeforeScan) {
    guideBeforeScan.textContent = showCodeDemo
      ? 'You see the hero, workflow strip (Scan → Rank → A-Fix → Ship), capability list, and a getting-started checklist. Run the demo to unlock charts.'
      : 'You see the hero, workflow strip (Scan → Rank → A-Fix → Ship), capability list, and a getting-started checklist. Run + New scan to unlock charts.';
  }

  window.AegisModules?.updateCloudDemoUi?.();
}

window.aegisIsProductionDeploy = isProductionDeploy;
window.aegisHasRealCodeScan = hasRealCodeScan;
window.aegisCloudDemoRepo = () => CLOUD_DEMO_REPO;

function fixTime(severity) {
  if (severity === 'critical') return '30 min';
  if (severity === 'warning') return '1 hr';
  return '15 min';
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Auth ──

async function loadAuth() {
  try {
    githubUser = await api('/api/auth/me');
    renderAuth();
    if (githubUser.connected) loadRepos();
  } catch {
    githubUser = { connected: false };
    renderAuth();
  }
  if (currentView === 'settings') renderSettings();
  renderHomeChecklist();
}

function renderAuth() {
  const sidebar = $('#sidebarUser');
  const header = $('#githubAuth');

  if (githubUser?.connected) {
    sidebar.classList.add('connected');
    sidebar.innerHTML = `
      <img class="user-avatar" src="${githubUser.avatarUrl}" alt="">
      <div class="user-meta">
        <span class="user-name">@${escapeHtml(githubUser.login)}</span>
        <span class="user-status">GitHub connected</span>
        <button type="button" class="sidebar-logout" id="sidebarLogoutBtn">Sign out</button>
      </div>`;
    header.innerHTML = `
      <div class="user-chip">
        <img src="${githubUser.avatarUrl}" alt="">
        <span>@${escapeHtml(githubUser.login)}</span>
        <button type="button" class="btn-link" id="logoutBtn">Sign out</button>
      </div>`;
  } else {
    sidebar.classList.remove('connected');
    sidebar.innerHTML = 'Sign in with GitHub to scan private repositories and browse your org.';
    header.innerHTML = `
      <a href="/login" class="header-link">Sign in</a>
      <button type="button" class="header-btn" id="connectGithubBtn">Connect</button>`;
    $('#repoCount').textContent = '—';
  }
}

function setPageContext(title, breadcrumb, subtitle) {
  $('#pageTitle').textContent = title;
  $('#pageBreadcrumb').textContent = breadcrumb;
  if (subtitle !== undefined) $('#scanMeta').textContent = subtitle;
}

async function loadRepoScanMap() {
  try {
    const scans = await api('/api/scans');
    const map = {};
    for (const s of scans) {
      const prev = map[s.repo];
      if (!prev || new Date(s.startedAt) > new Date(prev.startedAt)) {
        map[s.repo] = s;
      }
    }
    repoScanMap = map;
  } catch {
    repoScanMap = {};
  }
}

function repoIssuesCell(fullName) {
  const scan = repoScanMap[fullName];
  let inner;
  if (!scan) {
    inner = '<span class="repo-issues none">Not scanned</span>';
  } else if (scan.status === 'failed' && scan.error) {
    inner = `<span class="repo-issues error" title="${escapeHtml(scan.error)}">${escapeHtml(scan.error)}</span>`;
  } else {
    const { critical, warning, info } = scan.stats;
    const open = critical + warning + info;
    if (open === 0) {
      inner = '<span class="repo-issues clean">Clean</span>';
    } else {
      const parts = [];
      if (critical) parts.push(`<span class="issue-chip crit">${critical} critical</span>`);
      if (warning) parts.push(`<span class="issue-chip warn">${warning} high</span>`);
      if (info) parts.push(`<span class="issue-chip info">${info} info</span>`);
      inner = `<div class="repo-issues">${parts.join('')}</div>`;
    }
  }
  return `<button type="button" class="repo-issues-btn" data-repo="${escapeHtml(fullName)}">${inner}</button>`;
}

async function loadRepos() {
  const tbody = $('#reposList');
  if (githubUser?.connected) {
    tbody.innerHTML = '<tr><td colspan="6" class="repos-loading">Loading repositories…</td></tr>';
  }

  try {
    await loadRepoScanMap();
    allRepos = await api('/api/github/repos');
    $('#repoCount').textContent = allRepos.length;
    $('#repoTotal').textContent = `${allRepos.length} repositories`;

    const list = $('#repoList');
    list.innerHTML = '';
    allRepos.forEach((r) => {
      const opt = document.createElement('option');
      opt.value = r.fullName;
      list.appendChild(opt);
    });

    if (currentView === 'repos') renderReposTable(allRepos);
  } catch {
    allRepos = [];
    $('#repoCount').textContent = '—';
    $('#repoTotal').textContent = 'Could not load repositories';
    if (currentView === 'repos') {
      tbody.innerHTML = '<tr><td colspan="6" class="repos-loading">Failed to load repositories</td></tr>';
    }
  }
}

function renderReposTable(repos) {
  const tbody = $('#reposList');
  tbody.innerHTML = '';

  if (!repos.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="repos-loading">No repositories match your filter</td></tr>';
    return;
  }

  for (const r of repos) {
    const tr = document.createElement('tr');
    const updated = r.updatedAt ? new Date(r.updatedAt).toLocaleDateString() : '—';
    tr.innerHTML = `
      <td>
        <a href="${escapeHtml(r.url)}" target="_blank" rel="noopener" class="repo-name">${escapeHtml(r.fullName)}</a>
      </td>
      <td class="col-issues-cell">${repoIssuesCell(r.fullName)}</td>
      <td><span class="vis-badge ${r.private ? 'private' : 'public'}">${r.private ? 'Private' : 'Public'}</span></td>
      <td><span class="branch-tag">${escapeHtml(r.defaultBranch)}</span></td>
      <td class="repo-updated">${updated}</td>
      <td><button type="button" class="btn-sm-outline scan-repo-btn" data-repo="${escapeHtml(r.fullName)}" data-branch="${escapeHtml(r.defaultBranch)}">Scan</button></td>`;
    tbody.appendChild(tr);
  }
}

function filterRepos(query) {
  const q = query.toLowerCase().trim();
  if (!q) return renderReposTable(allRepos);
  renderReposTable(allRepos.filter((r) => r.fullName.toLowerCase().includes(q)));
}

function setActiveNav(id) {
  $$('.nav-item').forEach((n) => n.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function hideAllPanels() {
  $('#homeView').classList.add('hidden');
  $('#dashboard').classList.add('hidden');
  $('#statsStrip').classList.add('hidden');
  $('#overviewCharts').classList.add('hidden');
  $('#overviewGuideWrap')?.classList.add('hidden');
  $('#reposView').classList.add('hidden');
  $('#settingsView').classList.add('hidden');
  $('#docsView').classList.add('hidden');
  $('#prView').classList.add('hidden');
  $('#autofixQueueView').classList.add('hidden');
  $('#scannersView').classList.add('hidden');
  $('#integrationsView').classList.add('hidden');
}

function countWorkspaceFixable() {
  let fixable = 0;
  for (const scan of Object.values(repoScanMap)) {
    if (scan.status !== 'complete') continue;
    for (const f of scan.findings ?? []) {
      if (f.fixed) continue;
      if (f.autofix || llmAvailable) fixable += 1;
    }
  }
  return fixable;
}

function updateSidebarStats() {
  const m = computeOverviewMetrics();
  const fixable = countWorkspaceFixable();

  $('#sidebarStatRepos').textContent = m.repoCount || '—';
  $('#sidebarStatOpen').textContent = m.open || '—';
  $('#sidebarStatScore').textContent = m.avgScore ?? '—';

  const findingsBadge = $('#findingsCount');
  if (findingsBadge) {
    findingsBadge.textContent = String(m.open);
    findingsBadge.classList.toggle('hidden', m.open === 0);
  }

  const autofixBadge = $('#autofixCount');
  if (autofixBadge) {
    autofixBadge.textContent = String(fixable);
    autofixBadge.classList.toggle('hidden', fixable === 0);
  }
}

function setModulePill(moduleId) {
  $$('.module-pill').forEach((pill) => {
    const active = pill.dataset.module === moduleId;
    pill.classList.toggle('active', active);
    pill.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  const navIds = ['navCodeModule', 'navCloudModule', 'navAttackModule', 'navProtectModule'];
  const map = { code: 'navCodeModule', cloud: 'navCloudModule', attack: 'navAttackModule', protect: 'navProtectModule' };
  navIds.forEach((id) => {
    $(`#${id}`)?.classList.toggle('hidden', id !== map[moduleId]);
  });
}

const SCORE_RING_CIRC = 2 * Math.PI * 48;

function computeOverviewMetrics() {
  const scans = Object.values(repoScanMap).filter((s) => s.status === 'complete');
  let crit = 0;
  let warn = 0;
  let info = 0;
  let fixed = 0;
  let open = 0;
  let totalScore = 0;
  let scored = 0;
  const repoRows = [];

  for (const scan of scans) {
    crit += scan.stats?.critical ?? 0;
    warn += scan.stats?.warning ?? 0;
    info += scan.stats?.info ?? 0;
    fixed += scan.stats?.resolved ?? 0;
    open += (scan.stats?.critical ?? 0) + (scan.stats?.warning ?? 0) + (scan.stats?.info ?? 0);
    if (typeof scan.stats?.score === 'number') {
      totalScore += scan.stats.score;
      scored += 1;
    }
    const repoOpen = (scan.stats?.critical ?? 0) + (scan.stats?.warning ?? 0) + (scan.stats?.info ?? 0);
    repoRows.push({ repo: scan.repo, open: repoOpen });
  }

  repoRows.sort((a, b) => b.open - a.open);

  return {
    crit,
    warn,
    info,
    fixed,
    open,
    avgScore: scored ? Math.round(totalScore / scored) : null,
    repoCount: scans.length,
    repoRows: repoRows.slice(0, 8),
    hasData: scans.length > 0,
  };
}

function renderOverviewCharts() {
  const section = $('#overviewCharts');
  if (!section) return;

  const m = computeOverviewMetrics();
  section.classList.remove('hidden');

  $('#chartSeverityTotal').textContent = m.hasData ? `${m.open} open` : 'No data';
  $('#chartRepoCount').textContent = m.hasData ? `${m.repoCount} repo${m.repoCount === 1 ? '' : 's'}` : '0 repos';

  const sevChart = $('#severityBarChart');
  const sevMax = Math.max(m.crit, m.warn, m.info, 1);
  if (!m.hasData) {
    sevChart.innerHTML = `<div class="chart-empty">${chartEmptyMsg()}</div>`;
    $('#severityLegend').textContent = '';
  } else {
    const rows = [
      { key: 'crit', label: 'Critical', val: m.crit, cls: 'crit' },
      { key: 'warn', label: 'High', val: m.warn, cls: 'warn' },
      { key: 'info', label: 'Info', val: m.info, cls: 'info' },
    ];
    sevChart.innerHTML = rows.map((r) => `
      <div class="sev-bar-row">
        <span class="sev-bar-label">${r.label}</span>
        <div class="sev-bar-track"><div class="sev-bar-fill ${r.cls}" style="width:${Math.round((r.val / sevMax) * 100)}%"></div></div>
        <span class="sev-bar-val">${r.val}</span>
      </div>`).join('');
    $('#severityLegend').textContent = `${m.crit} critical · ${m.warn} high · ${m.info} info across workspace`;
  }

  const ring = $('#scoreRingFill');
  const ringVal = $('#scoreRingVal');
  const ringNote = $('#scoreRingNote');
  if (m.avgScore !== null) {
    const pct = m.avgScore / 100;
    ring.style.strokeDashoffset = String(SCORE_RING_CIRC * (1 - pct));
    ringVal.textContent = String(m.avgScore);
    ringNote.textContent = `Average across ${m.repoCount} scanned repo${m.repoCount === 1 ? '' : 's'}`;
  } else {
    ring.style.strokeDashoffset = String(SCORE_RING_CIRC);
    ringVal.textContent = '—';
    ringNote.textContent = shouldShowCodeDemo()
      ? 'Run a scan to calculate your score'
      : 'Run + New scan to calculate your score';
  }

  const repoChart = $('#repoBarChart');
  if (!m.hasData || !m.repoRows.length) {
    repoChart.innerHTML = '<div class="chart-empty">Scan repositories to compare coverage</div>';
  } else {
    const maxOpen = Math.max(...m.repoRows.map((r) => r.open), 1);
    repoChart.innerHTML = m.repoRows.map((r) => {
      const short = r.repo.includes('/') ? r.repo.split('/').pop() : r.repo;
      return `
        <div class="repo-bar-row">
          <span class="repo-bar-name" title="${escapeHtml(r.repo)}">${escapeHtml(short ?? r.repo)}</span>
          <div class="repo-bar-track"><div class="repo-bar-fill" style="width:${Math.round((r.open / maxOpen) * 100)}%"></div></div>
          <span class="sev-bar-val">${r.open}</span>
        </div>`;
    }).join('');
  }

  const total = m.fixed + m.open;
  const fixedPct = total ? Math.round((m.fixed / total) * 100) : 0;
  const openPct = total ? 100 - fixedPct : 100;
  $('#remediationFixed').style.width = total ? `${fixedPct}%` : '0%';
  $('#remediationOpen').style.width = total ? `${openPct}%` : '100%';
  $('#remediationFixedVal').textContent = String(m.fixed);
  $('#remediationOpenVal').textContent = String(m.open);
}

function renderHomeChecklist() {
  const list = $('#homeChecklist');
  if (!list) return;

  const hasScan = Boolean(currentScan) || Object.keys(repoScanMap).length > 0;
  const hasDemo = Object.values(repoScanMap).some((s) => s.repo === DEMO_REPO) || currentScan?.repo === DEMO_REPO;
  const hasRealScan = Object.values(repoScanMap).some((s) => s.repo !== DEMO_REPO);
  const hasFix = Object.values(repoScanMap).some((s) => (s.findings ?? []).some((f) => f.fixed))
    || (currentScan?.findings ?? []).some((f) => f.fixed);

  const steps = {
    demo: !shouldShowCodeDemo() || hasDemo || hasScan,
    github: Boolean(githubUser?.connected),
    repo: hasRealScan,
    fix: hasFix,
  };

  list.querySelectorAll('li[data-step]').forEach((li) => {
    const done = steps[li.dataset.step];
    li.classList.toggle('done', Boolean(done));
    li.querySelector('.check-icon').textContent = done ? '✓' : '○';
  });

  const connectBtn = $('#homeConnectBtn');
  if (connectBtn) {
    connectBtn.textContent = githubUser?.connected ? 'Browse repositories' : 'Connect GitHub';
  }
  updateOverviewGuideSteps();
  updateDemoUi();
}

function showHomeView() {
  $('#homeView').classList.remove('hidden');
  renderOverviewCharts();
  const showDemo = shouldShowCodeDemo();
  setPageContext(
    'Overview',
    'Aegis Loop · Code',
    showDemo
      ? (githubUser?.connected
        ? 'Run a demo or scan your repos — findings rank by severity with one-click A-Fix'
        : 'Run the demo scan to see findings in under a minute — no GitHub required')
      : (githubUser?.connected
        ? 'Scan repositories and pull requests — findings rank by severity with one-click A-Fix'
        : 'Connect GitHub and run your first scan')
  );
  renderHomeChecklist();
  updateDemoUi();
}

function updateOverviewGuideSteps() {
  const list = $('#overviewGuideSteps');
  if (!list) return;

  const m = computeOverviewMetrics();
  const hasScan = Boolean(currentScan) || Object.keys(repoScanMap).length > 0;
  const hasFix = Object.values(repoScanMap).some((s) => (s.findings ?? []).some((f) => f.fixed))
    || (currentScan?.findings ?? []).some((f) => f.fixed);

  const steps = {
    demo: hasScan,
    kpi: m.hasData,
    charts: m.hasData,
    next: m.open > 0 || hasFix,
  };

  list.querySelectorAll('li[data-step]').forEach((li) => {
    const done = Boolean(steps[li.dataset.step]);
    li.classList.toggle('done', done);
  });
}

function updateStatsStrip(scan) {
  if (!scan?.stats) return;
  const scope = $('#statsStripScope');
  if (scope) scope.textContent = 'This scan';
  const repoLabel = $('#statRepoLabel');
  if (repoLabel) repoLabel.textContent = 'Repository';

  $('#statCrit').textContent = scan.stats.critical;
  $('#statWarn').textContent = scan.stats.warning;
  $('#statResolved').textContent = scan.stats.resolved;
  $('#statScore').textContent = scan.stats.score;
  $('#repoChip').textContent = scan.repo;
  const publishBtn = $('#publishBtn');
  publishBtn.classList.toggle('hidden', !(scan.pullRequest && !scan.githubCommentUrl));
}

function updateStatsStripWorkspace() {
  const m = computeOverviewMetrics();
  const scope = $('#statsStripScope');
  if (scope) scope.textContent = 'Workspace · latest scan per repo';
  const repoLabel = $('#statRepoLabel');
  if (repoLabel) repoLabel.textContent = 'Repos scanned';

  $('#statCrit').textContent = m.crit;
  $('#statWarn').textContent = m.warn;
  $('#statResolved').textContent = m.fixed;
  $('#statScore').textContent = m.avgScore ?? '—';
  $('#repoChip').textContent = m.repoCount ? String(m.repoCount) : '—';
  $('#publishBtn').classList.add('hidden');
}

async function loadWorkspaceFindings() {
  const scans = await api('/api/scans');
  allScansCache = scans;
  await loadRepoScanMap();
  updateSidebarStats();

  const rows = [];
  for (const scan of Object.values(repoScanMap)) {
    if (scan.status !== 'complete') continue;
    let full = scan;
    if (!Array.isArray(full.findings)) {
      try {
        full = await api(`/api/scans/${scan.id}`);
      } catch {
        continue;
      }
    }
    for (const f of full.findings ?? []) {
      rows.push({ ...f, _scanId: full.id, _scanRepo: full.repo, _module: 'code', _scan: full });
    }
  }

  try {
    const cloudScans = await api('/api/cloud/scans');
    const cloudLatest = new Map();
    for (const scan of cloudScans) {
      if (scan.status !== 'complete') continue;
      if (!cloudLatest.has(scan.repo)) cloudLatest.set(scan.repo, scan);
    }
    for (const scan of cloudLatest.values()) {
      let full = scan;
      if (!Array.isArray(full.findings)) {
        try {
          full = await api(`/api/cloud/scans/${scan.id}`);
        } catch {
          continue;
        }
      }
      for (const f of full.findings ?? []) {
        rows.push({ ...f, _scanId: full.id, _scanRepo: full.repo, _module: 'cloud', _scan: full });
      }
    }
  } catch { /* cloud optional */ }

  try {
    const attackScans = await api('/api/attack/scans');
    const attackLatest = new Map();
    for (const scan of attackScans) {
      if (scan.status !== 'complete') continue;
      const key = scan.target ?? scan.repo;
      if (!attackLatest.has(key)) attackLatest.set(key, scan);
    }
    for (const scan of attackLatest.values()) {
      let full = scan;
      if (!Array.isArray(full.findings)) {
        try {
          full = await api(`/api/attack/scans/${scan.id}`);
        } catch {
          continue;
        }
      }
      for (const f of full.findings ?? []) {
        rows.push({
          ...f,
          _scanId: full.id,
          _scanRepo: full.target ?? full.repo,
          _module: 'attack',
          _scan: full,
        });
      }
    }
  } catch { /* attack optional */ }

  rows.sort((a, b) => {
    const rank = { critical: 0, warning: 1, info: 2 };
    return (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3);
  });
  return rows;
}

async function showFindingsView() {
  currentView = 'findings';
  hideAllPanels();
  setActiveNav('navFindings');
  setModulePill('code');
  $('#dashboard').classList.remove('hidden');

  try {
    const rows = await loadWorkspaceFindings();
    allFindings = rows;

    if (!rows.length) {
      $('#statsStrip').classList.add('hidden');
      setPageContext(
        'Findings',
        'Aegis Loop · Code',
        codeScanEmptyMsg(true)
      );
      renderFindingsTable([], { empty: 'no-scans' });
      history.replaceState(null, '', '/app/?view=findings');
      return;
    }

    $('#statsStrip').classList.remove('hidden');
    updateStatsStripWorkspace();

    const open = rows.filter((f) => !f.fixed).length;
    setPageContext(
      'Findings',
      'Aegis Loop · Workspace',
      `${open} open across Code, Cloud, and Attack`
    );

    const q = $('#findingsSearchInput').value.trim();
    if (q) filterFindings(q);
    else renderFindingsTable(rows);

    history.replaceState(null, '', '/app/?view=findings');
  } catch (e) {
    toast(e.message || 'Could not load findings');
    renderFindingsTable([], { empty: 'error' });
  }
}

function showPRView() {
  currentView = 'pr';
  hideAllPanels();
  $('#prView').classList.remove('hidden');
  setPageContext(
    'Pull requests',
    'Aegis Loop · Code',
    'PR comments, commit checks, and autofix on every merge'
  );
  setActiveNav('navPR');
  setModulePill('code');
  renderPRScans();
}

function showAutofixQueueView() {
  currentView = 'autofix';
  hideAllPanels();
  $('#autofixQueueView').classList.remove('hidden');
  setPageContext(
    'A-Fix queue',
    'Aegis Loop · Remediate',
    'Open findings with template or AI remediation ready to apply'
  );
  setActiveNav('navAutofix');
  setModulePill('code');
  renderAutofixQueue();
}

function showScannersView() {
  currentView = 'scanners';
  hideAllPanels();
  $('#scannersView').classList.remove('hidden');
  setPageContext('Scanners', 'Aegis Loop · Code', 'Engines running on every repository and PR scan');
  setActiveNav('navScanners');
  setModulePill('code');
  renderScanners();
}

function showIntegrationsView() {
  currentView = 'integrations';
  hideAllPanels();
  $('#integrationsView').classList.remove('hidden');
  setPageContext('Integrations', 'Aegis Loop · Workspace', 'GitHub, webhooks, PR checks, and AI autofix');
  setActiveNav('navIntegrations');
  setModulePill('code');
  renderIntegrations();
}

async function renderPRScans() {
  const tbody = $('#prScanList');
  tbody.innerHTML = '<tr><td colspan="5" class="repos-loading">Loading PR scan history…</td></tr>';

  try {
    const scans = await api('/api/scans');
    allScansCache = scans;
    updateSidebarStats();

    const prScans = scans.filter((s) => s.pullRequest);
    if (!prScans.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="repos-loading">No PR scans yet — scan a pull request to post comments and checks</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    for (const s of prScans) {
      const open = (s.stats?.critical ?? 0) + (s.stats?.warning ?? 0) + (s.stats?.info ?? 0);
      const gh = s.githubCommentUrl
        ? '<span class="gh-status linked">Comment posted</span>'
        : '<span class="gh-status">Not published</span>';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><a href="${escapeHtml(s.pullRequest.url)}" target="_blank" rel="noopener" class="repo-name">#${s.pullRequest.number} ${escapeHtml(s.pullRequest.title.slice(0, 48))}${s.pullRequest.title.length > 48 ? '…' : ''}</a></td>
        <td><span class="branch-tag">${escapeHtml(s.repo)}</span></td>
        <td>${open} open</td>
        <td>${gh}</td>
        <td><button type="button" class="btn-sm-outline pr-open-scan" data-id="${escapeHtml(s.id)}">Open</button></td>`;
      tbody.appendChild(tr);
    }

    tbody.querySelectorAll('.pr-open-scan').forEach((btn) => {
      btn.addEventListener('click', async () => {
        renderScan(await api(`/api/scans/${btn.dataset.id}`));
      });
    });
  } catch {
    tbody.innerHTML = '<tr><td colspan="5" class="repos-loading">Could not load PR scans</td></tr>';
  }
}

async function renderAutofixQueue() {
  const tbody = $('#autofixQueueList');

  try {
    await loadRepoScanMap();
    updateSidebarStats();

    const rows = [];
    for (const scan of Object.values(repoScanMap)) {
      if (scan.status !== 'complete') continue;
      let full = scan;
      if (!Array.isArray(full.findings)) {
        try {
          full = await api(`/api/scans/${scan.id}`);
        } catch {
          continue;
        }
      }
      for (const f of full.findings ?? []) {
        if (f.fixed) continue;
        if (!f.autofix && !llmAvailable) continue;
        rows.push({ scan: full, finding: f });
      }
    }

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="repos-loading">No fixable findings — run a scan or check back after new commits</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    for (const { scan, finding: f } of rows) {
      const fixType = f.autofix ? 'Template' : 'AI';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHtml(f.title)}</strong><br><small style="color:var(--text-3);font-family:var(--mono);font-size:10px">${escapeHtml(f.file)}:${f.line}</small></td>
        <td><span class="branch-tag">${escapeHtml(scan.repo)}</span></td>
        <td><span class="sev-badge ${sevClass(f.severity)}">${sevLabel(f.severity)}</span></td>
        <td>${fixType}</td>
        <td><button type="button" class="status-autofix queue-fix-btn" data-scan="${escapeHtml(scan.id)}" data-finding="${escapeHtml(f.id)}">A-Fix</button></td>`;
      tbody.appendChild(tr);
    }

    tbody.querySelectorAll('.queue-fix-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (currentScan?.id !== btn.dataset.scan) {
          renderScan(await api(`/api/scans/${btn.dataset.scan}`));
        }
        openAutofixPanel(btn.dataset.finding, btn.dataset.scan);
      });
    });
  } catch {
    tbody.innerHTML = '<tr><td colspan="5" class="repos-loading">Could not load A-Fix queue</td></tr>';
  }
}

function renderScanners() {
  const grid = $('#scannerGrid');
  grid.innerHTML = SCANNER_ENGINES.map((engine) => {
    let on = engine.always;
    if (engine.healthKey === 'osv') on = healthInfo?.osv?.enabled !== false;
    if (engine.healthKey === 'ai') on = Boolean(healthInfo?.ai?.configured);
    const status = on ? '<span class="status-pill on">Active</span>' : '<span class="status-pill off">Not configured</span>';
    return `
      <article class="scanner-card">
        <div class="scanner-card-head">
          <h3>${escapeHtml(engine.title)}</h3>
          ${status}
        </div>
        <p>${escapeHtml(engine.desc)}</p>
      </article>`;
  }).join('');
}

function renderIntegrations() {
  const grid = $('#integrationGrid');
  const ghConnected = Boolean(githubUser?.connected);
  const oauth = Boolean(healthInfo?.github?.oauth);
  const webhook = Boolean(healthInfo?.github?.webhook);
  const ai = Boolean(healthInfo?.ai?.configured);

  grid.innerHTML = `
    <article class="integration-card">
      <div class="integration-card-head">
        <h3>GitHub</h3>
        <span class="status-pill ${ghConnected ? 'on' : 'off'}">${ghConnected ? 'Connected' : 'Not connected'}</span>
      </div>
      <p>OAuth sign-in, repository access, PR scanning, and autofix commits to branches.</p>
      ${ghConnected ? '' : '<button type="button" class="btn-outline btn-sm" id="integrationsConnectBtn">Connect GitHub</button>'}
    </article>
    <article class="integration-card">
      <div class="integration-card-head">
        <h3>Pull request checks</h3>
        <span class="status-pill on">Available</span>
      </div>
      <p><code>aegis-loop/code</code> commit status on PR head commits when you scan a pull request.</p>
    </article>
    <article class="integration-card">
      <div class="integration-card-head">
        <h3>PR webhooks</h3>
        <span class="status-pill ${webhook ? 'on' : 'off'}">${webhook ? 'Configured' : 'Server not configured'}</span>
      </div>
      <p>Auto-scan on <code>pull_request</code> events when <code>GITHUB_WEBHOOK_SECRET</code> is set on the server.</p>
    </article>
    <article class="integration-card">
      <div class="integration-card-head">
        <h3>AI autofix</h3>
        <span class="status-pill ${ai ? 'on' : 'off'}">${ai ? 'Configured' : 'Not configured'}</span>
      </div>
      <p>${ai ? `Provider: ${escapeHtml(healthInfo.ai.provider ?? 'LLM')} · ${escapeHtml(healthInfo.ai.model ?? '')}` : 'Set ANTHROPIC_API_KEY or OPENAI_API_KEY on the server for AI-generated patches.'}</p>
    </article>
    <article class="integration-card">
      <div class="integration-card-head">
        <h3>Slack &amp; Jira</h3>
        <span class="status-pill soon">Team plan</span>
      </div>
      <p>Route critical findings to Slack channels and Jira — included on Team and Enterprise.</p>
      <a href="/#pricing" class="btn-outline btn-sm" target="_blank" rel="noopener">View pricing</a>
    </article>
    <article class="integration-card">
      <div class="integration-card-head">
        <h3>SSO &amp; audit log</h3>
        <span class="status-pill soon">Enterprise</span>
      </div>
      <p>SAML SSO and audit logging for regulated teams — contact us for early access.</p>
      <a href="mailto:${escapeHtml(healthInfo?.contactEmail ?? 'hello@aegisloop.dev')}" class="btn-outline btn-sm">Contact sales</a>
    </article>`;

  $('#integrationsConnectBtn')?.addEventListener('click', openAuthModal);
}

function showReposView() {
  currentView = 'repos';
  hideAllPanels();
  $('#reposView').classList.remove('hidden');
  setPageContext(
    'Repositories',
    'Aegis Loop · Coverage',
    githubUser?.connected ? 'All repositories you can access on GitHub' : 'Connect GitHub to browse repositories'
  );
  setActiveNav('navRepos');
  setModulePill('code');

  if (githubUser?.connected) {
    loadRepoScanMap().then(() => {
      if (allRepos.length) renderReposTable(allRepos);
      else loadRepos();
    });
  } else {
    $('#reposList').innerHTML = '<tr><td colspan="6" class="repos-loading">Connect GitHub to load repositories</td></tr>';
    $('#repoTotal').textContent = '—';
  }
  const q = $('#repoSearchInput').value.trim();
  if (q && allRepos.length) filterRepos(q);
}

function showFeedView() {
  currentView = 'feed';
  hideAllPanels();
  window.AegisModules?.hideModuleViews?.();
  $('#overviewGuideWrap')?.classList.remove('hidden');
  setActiveNav('navFeed');
  setModulePill('code');
  renderOverviewCharts();
  updateOverviewGuideSteps();
  window.AegisModules?.applyGuideVisibility?.('overview');
  window.AegisModules?.updateShowGuideButtons?.();

  const m = computeOverviewMetrics();
  if (m.hasData) {
    $('#statsStrip').classList.remove('hidden');
    updateStatsStripWorkspace();
    setPageContext(
      'Overview',
      'Aegis Loop · Code',
      `${m.repoCount} repos scanned · ${m.open} open findings · avg score ${m.avgScore ?? '—'}`
    );
  } else if (currentScan) {
    $('#statsStrip').classList.remove('hidden');
    updateStatsStrip(currentScan);
    const prPart = currentScan.pullRequest ? ` · PR #${currentScan.pullRequest.number}` : '';
    setPageContext(
      'Overview',
      'Aegis Loop · Code',
      `${currentScan.repo}${prPart} · ${new Date(currentScan.completedAt ?? currentScan.startedAt).toLocaleString()}`
    );
  } else {
    showHomeView();
    $('#findingsSearchInput').value = '';
  }
}

function showSettingsView() {
  currentView = 'settings';
  hideAllPanels();
  $('#settingsView').classList.remove('hidden');
  setPageContext('Settings', 'Aegis Loop · Workspace', 'Account, appearance, and scanner configuration');
  setActiveNav('navSettings');
  setModulePill('code');
  renderSettings();
}

function showDocsView(sectionId) {
  currentView = 'docs';
  hideAllPanels();
  $('#docsView').classList.remove('hidden');
  setPageContext('Documentation', 'Aegis Loop · Help', 'Guides for Overview, Code, Cloud, Attack, and Protect');
  setActiveNav('navDocs');
  setModulePill('code');
  renderDocs(sectionId);
}

function renderSettings() {
  const gh = $('#settingsGitHub');
  if (githubUser?.connected) {
    gh.innerHTML = `
      <div class="settings-status">
        <img src="${githubUser.avatarUrl}" alt="">
        <div>
          <strong>@${escapeHtml(githubUser.login)}</strong>
          <span class="settings-hint">Connected via GitHub</span>
        </div>
        <span class="settings-badge">Connected</span>
      </div>`;
  } else {
    gh.innerHTML = `
      <div class="settings-row">
        <div><strong>Not connected</strong><span class="settings-hint">Sign in to scan private repositories</span></div>
        <button type="button" class="btn-primary btn-sm" id="settingsConnectBtn">Connect GitHub</button>
      </div>`;
  }

  const scanner = $('#settingsScanner');
  const ai = healthInfo?.ai?.configured;
  const osv = healthInfo?.osv?.enabled !== false;
  const oauth = healthInfo?.github?.oauth;
  const prod = healthInfo?.production;
  const contact = healthInfo?.contactEmail ?? 'hello@aegisloop.dev';
  scanner.innerHTML = `
    <ul class="settings-list">
      <li>Static analysis (secrets, injection, eval)</li>
      <li>OSV dependency scanning ${osv ? '— enabled' : '— unavailable'}</li>
      <li>AI autofix ${ai ? '— configured' : '— not configured on server'}</li>
      <li>GitHub OAuth ${oauth ? '— enabled' : '— use PAT instead'}</li>
      <li>Deployment ${prod ? '— production' : '— local / development'}</li>
      <li>Contact — <a href="mailto:${escapeHtml(contact)}">${escapeHtml(contact)}</a></li>
    </ul>`;

  updateThemeLabels();
}

function renderDocs(activeId) {
  const body = $('#docsBody');
  const nav = DOC_SECTIONS.map((s) =>
    `<button type="button" class="doc-jump${s.id === activeId ? ' active' : ''}" data-doc="${s.id}">${s.title}</button>`
  ).join('');

  const cards = DOC_SECTIONS.map((s) =>
    `<article class="doc-card" id="doc-${s.id}"><h3>${s.title}</h3>${s.html}</article>`
  ).join('');

  body.innerHTML = `<div class="doc-nav">${nav}</div><div class="docs-grid">${cards}</div>`;

  if (activeId) {
    requestAnimationFrame(() => {
      document.getElementById(`doc-${activeId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
}

function openAuthModal() {
  $('#authModal').classList.remove('hidden');
  api('/api/health').then((h) => {
    const oauthOn = Boolean(h.github?.oauth);
    $('#oauthBtn').classList.toggle('hidden', !oauthOn);
    $('#patDivider').classList.toggle('hidden', !oauthOn);
  }).catch(() => {});
}

function openScanModal(tab) {
  $('#scanModal').classList.remove('hidden');
  $('#bulkProgress').classList.add('hidden');
  $('#bulkProgressFill').style.width = '0%';

  if (tab) {
    const tabEl = $(`.tab[data-tab="${tab}"]`);
    if (tabEl) {
      $$('.tab').forEach((t) => t.classList.remove('active'));
      tabEl.classList.add('active');
      $$('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== tab));
    }
  }

  if (githubUser?.connected && allRepos.length) {
    $('#bulkScanCount').textContent = `${allRepos.length} repositories will be scanned sequentially.`;
    $('#bulkScanBtn').textContent = `Scan all ${allRepos.length} repositories`;
    $('#bulkScanBtn').disabled = false;
  } else if (githubUser?.connected) {
    $('#bulkScanCount').textContent = 'Loading repository list…';
    $('#bulkScanBtn').disabled = true;
    loadRepos().then(() => {
      $('#bulkScanCount').textContent = `${allRepos.length} repositories will be scanned sequentially.`;
      $('#bulkScanBtn').textContent = `Scan all ${allRepos.length} repositories`;
      $('#bulkScanBtn').disabled = false;
    });
  } else {
    $('#bulkScanCount').textContent = 'Connect GitHub to scan all repositories.';
    $('#bulkScanBtn').disabled = true;
  }
}

async function connectWithPat() {
  const token = $('#authPatInput').value.trim();
  if (!token) return toast('Enter a token');
  try {
    await api('/api/auth/pat', { method: 'POST', body: JSON.stringify({ token }) });
    $('#authModal').classList.add('hidden');
    $('#authPatInput').value = '';
    await loadAuth();
    toast(`Connected as @${githubUser.login}`);
    showReposView();
  } catch (e) {
    toast(e.message);
  }
}

async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch {
    /* redirect even if request fails */
  }
  window.location.href = '/login';
}

// ── Feed rendering ──

function renderScan(scan) {
  currentScan = scan;
  allFindings = scan.findings ?? [];
  $('#findingsSearchInput').value = '';

  if (currentView === 'findings') {
    showFindingsView();
  } else if (currentView === 'repos') {
    showReposView();
    repoScanMap[scan.repo] = scan;
    if (allRepos.length) renderReposTable(allRepos);
  } else if (currentView === 'pr') {
    showPRView();
  } else if (currentView === 'autofix') {
    showAutofixQueueView();
  } else if (currentView === 'settings') {
    showSettingsView();
  } else if (currentView === 'docs') {
    showDocsView();
  } else if (currentView === 'scanners') {
    showScannersView();
  } else if (currentView === 'integrations') {
    showIntegrationsView();
  } else {
    showFeedView();
  }

  refreshHistory();
  renderHomeChecklist();
  history.replaceState(null, '', `/app/?scan=${scan.id}${currentView !== 'feed' ? `&view=${currentView}` : ''}`);
}

function renderFindingsTable(findings, opts = {}) {
  const tbody = $('#findingsList');
  tbody.innerHTML = '';
  const list = findings ?? [];

  if (!list.length) {
    let msg = 'No findings match your filter.';
    if (opts.empty === 'no-scans') {
      msg = codeScanEmptyMsg();
    } else if (opts.empty === 'error') {
      msg = 'Could not load findings. Try refreshing the page.';
    } else if (!$('#findingsSearchInput')?.value.trim()) {
      msg = 'No open findings — your workspace looks clean.';
    }
    tbody.innerHTML = `<tr><td colspan="6" class="repos-loading">${msg}</td></tr>`;
    return;
  }

  for (const f of list) {
    const mod = f._module ?? 'code';
    const modTag = moduleBadge(mod);
    const type = modTag ?? fileType(f.file);
    const tr = document.createElement('tr');
    if (f.fixed) tr.classList.add('row-fixed');

    const repo = f._scanRepo ?? currentScan?.repo ?? '—';
    const scanId = f._scanId ?? currentScan?.id ?? '';

    let statusCell;
    if (f.fixed) {
      statusCell = `<span class="status-fixed">Fixed</span>`;
    } else if (mod === 'code' && f.autofix) {
      statusCell = `<button type="button" class="status-autofix autofix-btn" data-id="${f.id}" data-scan="${scanId}">A-Fix</button>`;
    } else if (mod === 'code' && llmAvailable) {
      statusCell = `<button type="button" class="status-autofix autofix-btn ai-fix-btn" data-id="${f.id}" data-scan="${scanId}">A-Fix</button>`;
    } else if (mod === 'code') {
      statusCell = `<span class="status-todo">To Do</span>`;
    } else {
      statusCell = `<button type="button" class="status-autofix fix-guide-btn" data-id="${f.id}" data-scan="${scanId}" data-module="${mod}">Fix guide</button>`;
    }

    const locLine = f.line > 0 ? `${escapeHtml(f.file)}:${f.line}` : escapeHtml(f.file);

    tr.innerHTML = `
      <td><div class="type-badge ${type.cls}">${type.label}</div></td>
      <td>
        <div class="finding-name">${escapeHtml(f.title)}</div>
        <div class="finding-desc">${escapeHtml(f.message)}</div>
      </td>
      <td><span class="sev-badge ${sevClass(f.severity)}">${sevLabel(f.severity)}</span></td>
      <td>
        <span class="loc-repo">${escapeHtml(repo)}</span>
        <span class="loc-file">${locLine}</span>
      </td>
      <td><span class="fix-time">${fixTime(f.severity)}</span></td>
      <td>${statusCell}</td>`;

    tbody.appendChild(tr);
  }

  tbody.querySelectorAll('.autofix-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openAutofixPanel(btn.dataset.id, btn.dataset.scan);
    });
  });

  tbody.querySelectorAll('.fix-guide-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openFixGuidePanel(btn.dataset.id, btn.dataset.scan, btn.dataset.module);
    });
  });
}

function buildManualFixPrompt(finding, repo) {
  let text = `Security fix guidance — ${repo}\n\n`;
  text += `Issue: ${finding.title}\nSeverity: ${finding.severity}\nRule: ${finding.ruleId}\n`;
  text += `Location: ${finding.file}${finding.line ? `:${finding.line}` : ''}\n\n`;
  text += `Problem:\n${finding.message}\n\n`;
  if (finding.remediation) {
    text += `Summary:\n${finding.remediation.summary}\n\nSteps:\n`;
    finding.remediation.steps.forEach((step, i) => {
      text += `${i + 1}. ${step}\n`;
    });
    text += '\n';
  }
  text += `Vulnerable code:\n${finding.snippet}\n\n`;
  if (finding.autofix) {
    text += `Suggested fix:\n${finding.autofix.fixedLine}\n\n`;
    text += `${finding.autofix.description}\n\n`;
  } else if (!finding.remediation) {
    text += `Manual steps:\n`;
    text += `1. Open ${finding.file} at line ${finding.line}\n`;
    text += `2. Refactor or remove the vulnerable pattern described above\n`;
    text += `3. Run your test suite and re-scan to confirm the issue is resolved\n\n`;
  }
  text += `Important: Review all changes carefully before committing. AI suggestions may be incorrect.`;
  return text;
}

function buildRemediationPrompt(finding, scan, module) {
  const label = module === 'cloud' ? 'Cloud IaC fix' : 'Attack surface fix';
  let text = `${label} — ${scan.target ?? scan.repo}\n\n`;
  text += `Issue: ${finding.title}\nRule: ${finding.ruleId}\n\n`;
  if (finding.remediation) {
    text += `${finding.remediation.summary}\n\n`;
    finding.remediation.steps.forEach((step, i) => {
      text += `${i + 1}. ${step}\n`;
    });
  }
  if (module === 'cloud') {
    text += `\nAfter fixing, re-run the Cloud scan. Sync Protect for derived WAF rules.\n`;
  } else {
    text += `\nAfter fixing, re-probe the URL on the Attack tab. Sync Protect if needed.\n`;
  }
  return text;
}

async function openFixGuidePanel(findingId, scanId, module) {
  let scan;
  try {
    if (module === 'cloud') scan = await api(`/api/cloud/scans/${scanId}`);
    else if (module === 'attack') scan = await api(`/api/attack/scans/${scanId}`);
    else return toast('Unknown module');
  } catch {
    return toast('Could not load scan for this finding');
  }

  const f = scan.findings?.find((x) => x.id === findingId);
  if (!f) return toast('Finding not found');

  activeFinding = f;
  showAutofixPanel();
  $('#panelTitle').textContent = f.title;
  $('#panelDesc').textContent = f.remediation?.summary ?? f.message;
  $('#panelSeverity').textContent = sevLabel(f.severity);
  $('#panelSeverity').className = `sev-badge ${sevClass(f.severity)}`;
  $('#panelLocation').textContent = f.line > 0 ? `${f.file}:${f.line}` : f.file;
  $('#panelBefore').textContent = f.snippet || f.message;
  const steps = f.remediation?.steps ?? [];
  $('#panelAfter').textContent = steps.length
    ? steps.map((step, i) => `${i + 1}. ${step}`).join('\n\n')
    : 'Edit the file or server config manually, then re-scan this module.';
  $('#manualFixPrompt').value = buildRemediationPrompt(f, scan, module);
  $('#panelHint').textContent = module === 'cloud'
    ? 'Cloud findings are fixed in IaC — there is no auto-apply. Sync Protect after remediation.'
    : 'Attack findings are fixed in CDN or web server config — re-probe after deploy.';
  $('#applyFixBtn').classList.add('hidden');
  panelAiGenerated = false;
}

let panelSuppressClose = false;

function showAutofixPanel() {
  const panel = $('#autofixPanel');
  panel.classList.remove('hidden');
  panel.classList.remove('is-open');
  panelSuppressClose = true;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      panel.classList.add('is-open');
      setTimeout(() => { panelSuppressClose = false; }, 350);
    });
  });
}

function closeAutofixPanel() {
  if (panelSuppressClose) return;
  const panel = $('#autofixPanel');
  panel.classList.remove('is-open');
  setTimeout(() => {
    if (!panel.classList.contains('is-open')) {
      panel.classList.add('hidden');
    }
    activeFinding = null;
  }, 300);
}

function populateAutofixPanel(finding, autofix, aiGenerated) {
  panelAiGenerated = aiGenerated;
  $('#panelTitle').textContent = finding.title;
  $('#panelDesc').textContent = aiGenerated
    ? `AI-generated fix: ${autofix?.description ?? finding.message}`
    : (autofix?.description ?? finding.message);
  $('#panelSeverity').textContent = sevLabel(finding.severity);
  $('#panelSeverity').className = `sev-badge ${sevClass(finding.severity)}`;
  $('#panelLocation').textContent = `${finding.file}:${finding.line}`;
  $('#panelBefore').textContent = autofix?.originalLine ?? finding.snippet;
  $('#panelAfter').textContent = autofix?.fixedLine ?? 'Generate or apply a fix to see the suggested change.';
  $('#manualFixPrompt').value = buildManualFixPrompt(
    { ...finding, autofix: autofix ?? finding.autofix },
    currentScan?.repo ?? '—'
  );
  $('#panelHint').textContent = currentScan?.pullRequest
    ? 'Apply pushes a commit to the PR branch.'
    : 'Apply opens an autofix PR on GitHub (demo repos are marked fixed locally only).';

  const canApply = Boolean(autofix?.patchedFile || finding.autofix?.patchedFile || llmAvailable);
  $('#applyFixBtn').classList.toggle('hidden', !canApply);
  $('#applyFixBtn').disabled = false;
  $('#applyFixBtn').textContent = 'Apply AutoFix';
}

async function openAutofixPanel(findingId, scanId) {
  if (scanId && currentScan?.id !== scanId) {
    try {
      currentScan = await api(`/api/scans/${scanId}`);
    } catch {
      return toast('Could not load scan for this finding');
    }
  }

  const f = currentScan?.findings?.find((x) => x.id === findingId);
  if (!f || f.fixed) return toast('This finding is already fixed');

  activeFinding = f;
  showAutofixPanel();
  populateAutofixPanel(f, f.autofix, false);

  if (f.autofix) return;

  if (!llmAvailable) {
    $('#panelAfter').textContent = 'No automated patch — use the manual prompt below.';
    $('#applyFixBtn').classList.add('hidden');
    return;
  }

  $('#panelAfter').textContent = 'Generating AI fix…';
  $('#applyFixBtn').disabled = true;

  try {
    const result = await api(
      `/api/scans/${currentScan.id}/findings/${findingId}/autofix/generate`,
      { method: 'POST' }
    );
    const idx = currentScan.findings.findIndex((x) => x.id === findingId);
    if (idx >= 0) {
      currentScan.findings[idx] = { ...currentScan.findings[idx], autofix: result.autofix };
      activeFinding = currentScan.findings[idx];
    }
    populateAutofixPanel(activeFinding, result.autofix, true);
    if (currentView === 'findings') showFindingsView();
    else renderFindingsTable(allFindings);
  } catch (e) {
    $('#panelAfter').textContent = `Could not generate AI fix: ${e.message}`;
    $('#panelDesc').textContent = `${f.message} — use the manual prompt below or fix in your editor.`;
    $('#applyFixBtn').classList.add('hidden');
    toast(e.message);
  } finally {
    $('#applyFixBtn').disabled = false;
  }
}

function openIssuesModal(repoFullName) {
  issuesModalRepo = repoFullName;
  const scan = repoScanMap[repoFullName];
  const list = $('#issuesModalList');
  list.innerHTML = '';

  $('#issuesModalTitle').textContent = repoFullName;

  if (!scan) {
    $('#issuesModalSummary').textContent = 'This repository has not been scanned yet. Run a scan to check for security issues.';
    $('#issuesViewFeedBtn').classList.add('hidden');
  } else if (scan.status === 'failed') {
    $('#issuesModalSummary').textContent = `Scan failed: ${scan.error}`;
    $('#issuesViewFeedBtn').classList.add('hidden');
  } else {
    const open = (scan.findings ?? []).filter((f) => !f.fixed);
    if (!open.length) {
      $('#issuesModalSummary').textContent = 'No open security issues — this repository looks clean.';
    } else {
      $('#issuesModalSummary').textContent = `${open.length} open issue(s) · security score ${scan.stats.score}`;
      for (const f of open) {
        const li = document.createElement('li');
        li.innerHTML = `
          <strong>${escapeHtml(f.title)}</strong>
          <span>${escapeHtml(f.message)}</span>
          <small>${escapeHtml(f.file)}:${f.line} · ${sevLabel(f.severity)}</small>`;
        li.addEventListener('click', async () => {
          $('#issuesModal').classList.add('hidden');
          renderScan(scan);
          openAutofixPanel(f.id, scan.id);
        });
        list.appendChild(li);
      }
    }
    $('#issuesViewFeedBtn').classList.toggle('hidden', !scan.id);
  }

  $('#issuesModal').classList.remove('hidden');
}

function filterFindings(query) {
  const q = query.toLowerCase().trim();
  const source = allFindings ?? [];
  if (!q) return renderFindingsTable(source);
  const filtered = source.filter(
    (f) =>
      f.title.toLowerCase().includes(q) ||
      f.message.toLowerCase().includes(q) ||
      f.file.toLowerCase().includes(q) ||
      f.ruleId.toLowerCase().includes(q) ||
      (f._scanRepo ?? '').toLowerCase().includes(q)
  );
  renderFindingsTable(filtered);
}

// ── Scans ──

async function runDemoScan() {
  setLoading('#homeDemoBtn', true, 'Scanning demo…');
  try {
    renderScan(await api('/api/scans/demo', { method: 'POST' }));
    toast('Demo scan complete — try A-Fix on a finding');
  } catch (e) {
    toast(e.message);
  } finally {
    setLoading('#homeDemoBtn', false, 'Run demo scan');
  }
}

async function runBulkScan() {
  if (!githubUser?.connected || !allRepos.length) return toast('No repositories loaded');
  if (bulkScanning) return;

  bulkScanning = true;
  const btn = $('#bulkScanBtn');
  btn.disabled = true;
  $('#bulkProgress').classList.remove('hidden');

  const total = allRepos.length;
  let done = 0;

  for (const r of allRepos) {
    $('#bulkProgressText').textContent = `Scanning ${done + 1} of ${total}: ${r.fullName}…`;
    $('#bulkProgressFill').style.width = `${(done / total) * 100}%`;

    try {
      const scan = await api('/api/scans', {
        method: 'POST',
        body: JSON.stringify({ repo: r.fullName, branch: r.defaultBranch }),
      });
      repoScanMap[r.fullName] = scan;
    } catch (e) {
      repoScanMap[r.fullName] = {
        id: `failed-${r.fullName}`,
        repo: r.fullName,
        branch: r.defaultBranch,
        status: 'failed',
        error: e.message,
        findings: [],
        stats: { critical: 0, warning: 0, info: 0, resolved: 0, score: 0 },
        startedAt: new Date().toISOString(),
      };
    }
    done += 1;
  }

  $('#bulkProgressFill').style.width = '100%';
  $('#bulkProgressText').textContent = `Done — scanned ${total} repositories`;
  btn.disabled = false;
  bulkScanning = false;
  renderReposTable(allRepos);
  $('#scanModal').classList.add('hidden');
  showReposView();
  toast(`Bulk scan complete — ${total} repos`);
}

async function runScan(repo, branch) {
  setLoading('#scanBtn', true, 'Scanning…');
  try {
    renderScan(await api('/api/scans', { method: 'POST', body: JSON.stringify({ repo, branch }) }));
    $('#scanModal').classList.add('hidden');
    toast('Scan complete');
  } catch (e) {
    toast(e.message);
  } finally {
    setLoading('#scanBtn', false, 'Start scan');
  }
}

async function runPrScan(pr, publish) {
  setLoading('#prScanBtn', true, 'Scanning…');
  try {
    renderScan(await api('/api/scans/pull-request', {
      method: 'POST',
      body: JSON.stringify({ pr, publish }),
    }));
    $('#scanModal').classList.add('hidden');
    toast('PR scan complete');
  } catch (e) {
    toast(e.message);
  } finally {
    setLoading('#prScanBtn', false, 'Scan pull request');
  }
}

async function publishToPr() {
  if (!currentScan) return;
  try {
    const result = await api(`/api/scans/${currentScan.id}/github/publish`, { method: 'POST' });
    renderScan(result.scan);
    toast('Posted to pull request');
  } catch (e) {
    toast(e.message);
  }
}

async function applyAutofix() {
  if (!currentScan || !activeFinding) return;
  const btn = $('#applyFixBtn');
  btn.disabled = true;
  btn.textContent = 'Applying…';
  try {
    const result = await api(
      `/api/scans/${currentScan.id}/findings/${activeFinding.id}/autofix`,
      { method: 'POST', body: JSON.stringify({ createPr: true }) }
    );
    closeAutofixPanel();
    renderScan(await api(`/api/scans/${currentScan.id}`));
    toast(result.message);
    if (result.prUrl && !currentScan?.pullRequest) window.open(result.prUrl, '_blank');
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Apply AutoFix';
  }
}

function setLoading(sel, on, label) {
  const btn = $(sel);
  if (!btn) return;
  btn.disabled = on;
  btn.innerHTML = on ? `<span class="spinner"></span>${label}` : label;
}

async function refreshHistory() {
  try {
    const scans = await api('/api/scans');
    allScansCache = scans;
    const ul = $('#scanHistory');
    ul.innerHTML = '';
    if (!scans.length) {
      ul.innerHTML = `<li class="scan-history-empty">${scanHistoryEmptyMsg()}</li>`;
    } else {
      scans.slice(0, 6).forEach((s) => {
        const li = document.createElement('li');
        li.className = currentScan?.id === s.id ? 'active' : '';
        const prTag = s.pullRequest ? ` · PR #${s.pullRequest.number}` : '';
        li.innerHTML = `${s.repo}${prTag}<small>${s.stats.critical}c · ${s.stats.warning}h</small>`;
        li.addEventListener('click', async () => renderScan(await api(`/api/scans/${s.id}`)));
        ul.appendChild(li);
      });
    }
    await loadRepoScanMap();
    updateSidebarStats();
    renderOverviewCharts();
    renderHomeChecklist();
    if (currentView === 'feed') {
      updateOverviewGuideSteps();
      window.AegisModules?.applyGuideVisibility?.('overview');
    }
    updateDemoUi();
  } catch { /* offline */ }
}

// ── Events ──

$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    $$('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== tab.dataset.tab));
  });
});

$('#scanForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const repo = $('#repoInput').value.trim();
  const branch = $('#branchInput').value.trim() || 'main';
  if (!repo) return toast('Enter a repository');
  runScan(repo, branch);
});

$('#prForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const pr = $('#prInput').value.trim();
  if (!pr) return toast('Enter a pull request');
  runPrScan(pr, $('#publishToPr').checked);
});

$('#scanTriggerBtn').addEventListener('click', openScanModal);
$('#homeDemoBtn').addEventListener('click', runDemoScan);
$('#homeScanBtn').addEventListener('click', openScanModal);
$('#homeConnectBtn').addEventListener('click', () => {
  if (githubUser?.connected) {
    showReposView();
    return;
  }
  openAuthModal();
});
$('#patSubmitBtn').addEventListener('click', connectWithPat);
$('#publishBtn').addEventListener('click', publishToPr);
$('.side-panel-backdrop').addEventListener('click', () => closeAutofixPanel());
$('.side-panel-drawer').addEventListener('click', (e) => e.stopPropagation());
$('#autofixPanel .modal-close').addEventListener('click', () => closeAutofixPanel());
$$('[data-close-issues]').forEach((el) => el.addEventListener('click', () => $('#issuesModal').classList.add('hidden')));
$$('[data-close-scan]').forEach((el) => el.addEventListener('click', () => $('#scanModal').classList.add('hidden')));
$$('[data-close-auth]').forEach((el) => el.addEventListener('click', () => $('#authModal').classList.add('hidden')));

function closeTopModal() {
  if (!$('#scanModal').classList.contains('hidden')) $('#scanModal').classList.add('hidden');
  else if (!$('#authModal').classList.contains('hidden')) $('#authModal').classList.add('hidden');
  else if (!$('#issuesModal').classList.contains('hidden')) $('#issuesModal').classList.add('hidden');
  else if (!$('#cloudScanModal')?.classList.contains('hidden')) $('#cloudScanModal').classList.add('hidden');
  else if (!$('#attackProbeModal')?.classList.contains('hidden')) $('#attackProbeModal').classList.add('hidden');
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#autofixPanel').classList.contains('hidden') && $('#autofixPanel').classList.contains('is-open')) {
    closeAutofixPanel();
    return;
  }
  closeTopModal();
});
$('#applyFixBtn').addEventListener('click', applyAutofix);
$('#bulkScanBtn').addEventListener('click', runBulkScan);
$('#copyManualPromptBtn').addEventListener('click', () => {
  navigator.clipboard.writeText($('#manualFixPrompt').value).then(() => toast('Copied to clipboard')).catch(() => toast('Could not copy'));
});
$('#issuesViewFeedBtn').addEventListener('click', async () => {
  const scan = repoScanMap[issuesModalRepo];
  if (!scan?.id || scan.id.startsWith('failed-')) return;
  $('#issuesModal').classList.add('hidden');
  renderScan(await api(`/api/scans/${scan.id}`));
});
$('#findingsSearchInput').addEventListener('input', (e) => filterFindings(e.target.value));
$('#repoSearchInput').addEventListener('input', (e) => filterRepos(e.target.value));

$('#settingsThemeBtn').addEventListener('click', toggleTheme);
$('#settingsLogoutBtn').addEventListener('click', logout);
$('#docsBody').addEventListener('click', (e) => {
  const btn = e.target.closest('.doc-jump');
  if (!btn?.dataset.doc) return;
  $$('.doc-jump').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(`doc-${btn.dataset.doc}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.addEventListener('click', (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.id === 'logoutBtn' || target.id === 'sidebarLogoutBtn') {
    e.preventDefault();
    logout();
  }
  if (target.id === 'connectGithubBtn' || target.id === 'settingsConnectBtn') {
    e.preventDefault();
    openAuthModal();
  }
  if (target.classList.contains('scan-repo-btn')) {
    const repo = target.dataset.repo;
    const branch = target.dataset.branch || 'main';
    if (repo) runScan(repo, branch);
  }
  const issuesBtn = target.closest('.repo-issues-btn');
  if (issuesBtn?.dataset.repo) {
    e.preventDefault();
    openIssuesModal(issuesBtn.dataset.repo);
  }
});

$('#navFeed').addEventListener('click', (e) => {
  e.preventDefault();
  showFeedView();
});

$('#navOverviewGuide')?.addEventListener('click', (e) => {
  e.preventDefault();
  showFeedView();
  window.AegisModules?.revealGuide?.('overview');
});

$('#navFindings').addEventListener('click', (e) => {
  e.preventDefault();
  showFindingsView();
});

$('#navAutofix').addEventListener('click', (e) => {
  e.preventDefault();
  showAutofixQueueView();
});

$('#navPR').addEventListener('click', (e) => {
  e.preventDefault();
  showPRView();
});

$('#navScanners').addEventListener('click', (e) => {
  e.preventDefault();
  showScannersView();
});

$('#navIntegrations').addEventListener('click', (e) => {
  e.preventDefault();
  showIntegrationsView();
});

$$('.module-pill').forEach((pill) => {
  pill.addEventListener('click', () => {
    const mod = pill.dataset.module;
    if (mod === 'code') {
      showFeedView();
      return;
    }
    window.AegisModules?.switchModule(mod);
  });
});

$('#prScanBtnHeader')?.addEventListener('click', () => openScanModal('pr'));

$('#navRepos').addEventListener('click', (e) => {
  e.preventDefault();
  if (!githubUser?.connected) {
    openAuthModal();
    return toast('Connect GitHub to browse repositories');
  }
  showReposView();
});

$('#navSettings').addEventListener('click', (e) => {
  e.preventDefault();
  showSettingsView();
});

$('#navDocs').addEventListener('click', (e) => {
  e.preventDefault();
  showDocsView();
});

// ── Init ──

window.aegisApi = api;
window.aegisToast = toast;
window.aegisSetPageContext = setPageContext;
window.aegisHideAllPanels = hideAllPanels;
window.aegisShowFeedView = showFeedView;
window.aegisHasCodeScans = () => allScansCache.length > 0;
window.aegisShowDocsView = showDocsView;
window.aegisIsCodeFeedView = () => currentView === 'feed';
window.aegisOpenFixGuide = openFixGuidePanel;

initTheme();
window.AegisModules?.bindModuleEvents?.();

loadAuth().then(async () => {
  if (!githubUser?.connected) {
    window.location.replace('/login');
    return;
  }

  try {
    healthInfo = await api('/api/health');
    llmAvailable = Boolean(healthInfo.ai?.configured);
    updateDemoUi();
    await api('/api/protect/sync', { method: 'POST' }).catch(() => {});
  } catch { /* offline */ }

  const params = new URLSearchParams(location.search);
  if (params.get('auth') === 'success') {
    toast('GitHub connected');
    history.replaceState(null, '', '/app/');
    await loadAuth();
  }
  if (params.get('auth') === 'failed') {
    toast('GitHub connection failed');
    history.replaceState(null, '', '/app/');
  }
  const view = params.get('view');
  const moduleParam = params.get('module');
  const scanId = params.get('scan');
  if (moduleParam && ['cloud', 'attack', 'protect'].includes(moduleParam)) {
    await window.AegisModules?.switchModule(moduleParam);
    refreshHistory();
  } else if (scanId) {
    try {
      renderScan(await api(`/api/scans/${scanId}`));
    } catch {
      refreshHistory();
    }
  } else if (view === 'settings') {
    showSettingsView();
    refreshHistory();
  } else if (view === 'docs') {
    showDocsView(params.get('section') ?? undefined);
    refreshHistory();
  } else if (view === 'pr') {
    showPRView();
    refreshHistory();
  } else if (view === 'autofix') {
    showAutofixQueueView();
    refreshHistory();
  } else if (view === 'scanners') {
    showScannersView();
    refreshHistory();
  } else if (view === 'integrations') {
    showIntegrationsView();
    refreshHistory();
  } else if (view === 'findings') {
    await showFindingsView();
    refreshHistory();
  } else {
    refreshHistory().then(async () => {
      try {
        const scans = await api('/api/scans');
        if (scans.length && !scanId) {
          renderScan(await api(`/api/scans/${scans[0].id}`));
        } else {
          showFeedView();
        }
      } catch {
        showFeedView();
      }
    });
  }
});
