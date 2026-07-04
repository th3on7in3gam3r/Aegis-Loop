const API = window.location.origin;

let currentScan = null;
let activeFinding = null;
let githubUser = null;
let allFindings = [];
let allRepos = [];
let repoScanMap = {};
let currentView = 'feed';
let llmAvailable = false;
let issuesModalRepo = null;
let bulkScanning = false;
let panelAiGenerated = false;
let healthInfo = null;

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
    id: 'scanning',
    title: 'Scanning',
    keywords: 'scan repository branch pull request pr bulk osv secrets',
    html: `<p>Scans clone the target branch and run static rules plus OSV dependency lookup.</p>
      <ul><li><strong>Single repo</strong> — <code>owner/repo</code> + branch (default <code>main</code>)</li>
      <li><strong>All repos</strong> — sequential scan of every accessible repository</li>
      <li><strong>Pull request</strong> — <code>owner/repo#123</code> or PR URL; optional comment + check</li></ul>
      <p>Rules: exposed secrets, SQL injection patterns, <code>eval()</code>, vulnerable npm packages.</p>`,
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
  $('#emptyState').classList.add('hidden');
  $('#dashboard').classList.add('hidden');
  $('#statsStrip').classList.add('hidden');
  $('#reposView').classList.add('hidden');
  $('#settingsView').classList.add('hidden');
  $('#docsView').classList.add('hidden');
}

function showReposView() {
  currentView = 'repos';
  hideAllPanels();
  $('#reposView').classList.remove('hidden');
  setPageContext(
    'Repositories',
    'Aegis Loop · Assets',
    githubUser?.connected ? 'All repositories you can access on GitHub' : 'Connect GitHub to browse repositories'
  );
  setActiveNav('navRepos');

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
  setPageContext('Security feed', 'Aegis Loop · Code security');
  setActiveNav('navFeed');

  if (currentScan) {
    $('#dashboard').classList.remove('hidden');
    $('#statsStrip').classList.remove('hidden');
    const prPart = currentScan.pullRequest ? ` · PR #${currentScan.pullRequest.number}` : '';
    $('#scanMeta').textContent = `${currentScan.repo}${prPart} · ${new Date(currentScan.completedAt ?? currentScan.startedAt).toLocaleString()}`;
    const q = $('#findingsSearchInput').value.trim();
    if (q) filterFindings(q);
    else renderFindingsTable(allFindings);
  } else {
    $('#emptyState').classList.remove('hidden');
    $('#scanMeta').textContent = 'Run a scan to surface vulnerabilities across your codebase';
    $('#findingsSearchInput').value = '';
  }
}

function showSettingsView() {
  currentView = 'settings';
  hideAllPanels();
  $('#settingsView').classList.remove('hidden');
  setPageContext('Settings', 'Aegis Loop · Workspace', 'Account, appearance, and scanner configuration');
  setActiveNav('navSettings');
  renderSettings();
}

function showDocsView(sectionId) {
  currentView = 'docs';
  hideAllPanels();
  $('#docsView').classList.remove('hidden');
  setPageContext('Documentation', 'Aegis Loop · Help', 'Guides for scanning, GitHub, and A-Fix');
  setActiveNav('navDocs');
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
  scanner.innerHTML = `
    <ul class="settings-list">
      <li>Static analysis (secrets, injection, eval)</li>
      <li>OSV dependency scanning ${osv ? '— enabled' : '— unavailable'}</li>
      <li>AI autofix ${ai ? '— configured' : '— not configured on server'}</li>
      <li>GitHub OAuth ${oauth ? '— enabled' : '— use PAT instead'}</li>
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

function openScanModal() {
  $('#scanModal').classList.remove('hidden');
  $('#bulkProgress').classList.add('hidden');
  $('#bulkProgressFill').style.width = '0%';

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
  const token = $('#patInput').value.trim();
  if (!token) return toast('Enter a token');
  try {
    await api('/api/auth/pat', { method: 'POST', body: JSON.stringify({ token }) });
    $('#authModal').classList.add('hidden');
    $('#patInput').value = '';
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
  allFindings = scan.findings;
  $('#findingsSearchInput').value = '';
  showFeedView();

  const prPart = scan.pullRequest ? ` · PR #${scan.pullRequest.number}` : '';
  $('#scanMeta').textContent = `${scan.repo}${prPart} · ${new Date(scan.completedAt ?? scan.startedAt).toLocaleString()}`;
  $('#repoChip').textContent = scan.repo;

  $('#statCrit').textContent = scan.stats.critical;
  $('#statWarn').textContent = scan.stats.warning;
  $('#statResolved').textContent = scan.stats.resolved;
  $('#statScore').textContent = scan.stats.score;

  const publishBtn = $('#publishBtn');
  publishBtn.classList.toggle('hidden', !(scan.pullRequest && !scan.githubCommentUrl));

  renderFindingsTable(allFindings);
  refreshHistory();
  if (currentView === 'repos') {
    repoScanMap[scan.repo] = scan;
    renderReposTable(allRepos);
  }
  history.replaceState(null, '', `/app/?scan=${scan.id}`);
}

function renderFindingsTable(findings) {
  const tbody = $('#findingsList');
  tbody.innerHTML = '';

  if (!findings.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-3)">No findings match your search.</td></tr>`;
    return;
  }

  const repo = currentScan?.repo ?? '—';

  for (const f of findings) {
    const type = fileType(f.file);
    const tr = document.createElement('tr');
    if (f.fixed) tr.classList.add('row-fixed');

    let statusCell;
    if (f.fixed) {
      statusCell = `<span class="status-fixed">Fixed</span>`;
    } else if (f.autofix) {
      statusCell = `<button type="button" class="status-autofix autofix-btn" data-id="${f.id}">A-Fix</button>`;
    } else if (llmAvailable) {
      statusCell = `<button type="button" class="status-autofix autofix-btn ai-fix-btn" data-id="${f.id}">A-Fix</button>`;
    } else {
      statusCell = `<span class="status-todo">To Do</span>`;
    }

    tr.innerHTML = `
      <td><div class="type-badge ${type.cls}">${type.label}</div></td>
      <td>
        <div class="finding-name">${escapeHtml(f.title)}</div>
        <div class="finding-desc">${escapeHtml(f.message)}</div>
      </td>
      <td><span class="sev-badge ${sevClass(f.severity)}">${sevLabel(f.severity)}</span></td>
      <td>
        <span class="loc-repo">${escapeHtml(repo)}</span>
        <span class="loc-file">${escapeHtml(f.file)}:${f.line}</span>
      </td>
      <td><span class="fix-time">${fixTime(f.severity)}</span></td>
      <td>${statusCell}</td>`;

    tbody.appendChild(tr);
  }

  tbody.querySelectorAll('.autofix-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openAutofixPanel(btn.dataset.id);
    });
  });
}

function buildManualFixPrompt(finding, repo) {
  let text = `Security fix guidance — ${repo}\n\n`;
  text += `Issue: ${finding.title}\nSeverity: ${finding.severity}\nRule: ${finding.ruleId}\n`;
  text += `Location: ${finding.file}:${finding.line}\n\n`;
  text += `Problem:\n${finding.message}\n\n`;
  text += `Vulnerable code:\n${finding.snippet}\n\n`;
  if (finding.autofix) {
    text += `Suggested fix:\n${finding.autofix.fixedLine}\n\n`;
    text += `${finding.autofix.description}\n\n`;
  } else {
    text += `Manual steps:\n`;
    text += `1. Open ${finding.file} at line ${finding.line}\n`;
    text += `2. Refactor or remove the vulnerable pattern described above\n`;
    text += `3. Run your test suite and re-scan to confirm the issue is resolved\n\n`;
  }
  text += `Important: Review all changes carefully before committing. AI suggestions may be incorrect.`;
  return text;
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

async function openAutofixPanel(findingId) {
  const f = currentScan?.findings.find((x) => x.id === findingId);
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
    renderFindingsTable(allFindings);
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
          openAutofixPanel(f.id);
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
  if (!q) return renderFindingsTable(allFindings);
  const filtered = allFindings.filter(
    (f) =>
      f.title.toLowerCase().includes(q) ||
      f.message.toLowerCase().includes(q) ||
      f.file.toLowerCase().includes(q) ||
      f.ruleId.toLowerCase().includes(q)
  );
  renderFindingsTable(filtered);
}

// ── Scans ──

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
    const ul = $('#scanHistory');
    ul.innerHTML = '';
    scans.slice(0, 6).forEach((s) => {
      const li = document.createElement('li');
      li.className = currentScan?.id === s.id ? 'active' : '';
      li.innerHTML = `${s.repo}<small>${s.stats.critical}c · ${s.stats.warning}h</small>`;
      li.addEventListener('click', async () => renderScan(await api(`/api/scans/${s.id}`)));
      ul.appendChild(li);
    });
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
$('#emptyScanBtn').addEventListener('click', openScanModal);
$('#emptyConnectBtn').addEventListener('click', () => {
  if (githubUser?.connected) openScanModal();
  else openAuthModal();
});
$('#patSubmitBtn').addEventListener('click', connectWithPat);
$('#publishBtn').addEventListener('click', publishToPr);
$('.side-panel-backdrop').addEventListener('click', () => closeAutofixPanel());
$('.side-panel-drawer').addEventListener('click', (e) => e.stopPropagation());
$('#autofixPanel .modal-close').addEventListener('click', () => closeAutofixPanel());
$$('[data-close-issues]').forEach((el) => el.addEventListener('click', () => $('#issuesModal').classList.add('hidden')));
$$('[data-close-scan]').forEach((el) => el.addEventListener('click', () => $('#scanModal').classList.add('hidden')));
$$('[data-close-auth]').forEach((el) => el.addEventListener('click', () => $('#authModal').classList.add('hidden')));
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

$('#navAutofix').addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (!currentScan) return toast('Run a scan first');
  const first = currentScan.findings.find((f) => !f.fixed);
  if (first) openAutofixPanel(first.id);
  else toast('No open findings in current scan');
});

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

initTheme();

loadAuth().then(async () => {
  try {
    healthInfo = await api('/api/health');
    llmAvailable = Boolean(healthInfo.ai?.configured);
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
  const scanId = params.get('scan');
  if (scanId) {
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
  } else if (githubUser?.connected) {
    showReposView();
    refreshHistory();
  } else {
    refreshHistory();
  }
});
