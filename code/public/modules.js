/** Aegis Loop — Cloud, Attack, Protect module UI */
(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  let activeModule = 'code';
  let cloudScans = [];
  let attackScans = [];
  let protectRules = [];
  let protectEvents = [];

  const CLOUD_DEMO_REPO = 'aegis-loop/cloud-demo';

  const MODULE_NAV = {
    code: 'navCodeModule',
    cloud: 'navCloudModule',
    attack: 'navAttackModule',
    protect: 'navProtectModule',
  };

  const GUIDE_STORAGE_KEY = 'aegis-guide-dismiss';

  function guideDismissState() {
    try {
      return JSON.parse(localStorage.getItem(GUIDE_STORAGE_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function isGuideDismissed(mod) {
    return guideDismissState()[mod] === true;
  }

  function dismissGuide(mod) {
    const state = guideDismissState();
    state[mod] = true;
    localStorage.setItem(GUIDE_STORAGE_KEY, JSON.stringify(state));
    applyGuideVisibility(mod);
  }

  function revealGuide(mod) {
    const state = guideDismissState();
    delete state[mod];
    localStorage.setItem(GUIDE_STORAGE_KEY, JSON.stringify(state));
    applyGuideVisibility(mod);
    scrollToGuide(mod);
  }

  function showGuideBtnId(mod) {
    return `show${mod.charAt(0).toUpperCase()}${mod.slice(1)}Guide`;
  }

  function applyGuideVisibility(mod) {
    const guide = document.getElementById(`${mod}Guide`);
    if (guide) guide.classList.toggle('hidden', isGuideDismissed(mod));
    updateShowGuideButtons();
    window.aegisUpdateOverviewGuideHeader?.();
  }

  function updateShowGuideButtons() {
    ['overview', 'cloud', 'attack', 'protect'].forEach((mod) => {
      const btn = document.getElementById(showGuideBtnId(mod));
      if (!btn) return;
      const dismissed = isGuideDismissed(mod);
      let visible = dismissed;
      if (mod === 'overview') {
        visible = dismissed && activeModule === 'code' && (window.aegisIsCodeFeedView?.() ?? false);
      } else {
        visible = dismissed && activeModule === mod;
      }
      btn.classList.toggle('visible', visible);
    });
  }

  function scrollToGuide(mod) {
    document.getElementById(`${mod}Guide`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function markGuideSteps(listId, steps) {
    const list = document.getElementById(listId);
    if (!list) return;
    list.querySelectorAll('li[data-step]').forEach((li) => {
      const done = Boolean(steps[li.dataset.step]);
      li.classList.toggle('done', done);
    });
  }

  function updateCloudGuideSteps() {
    const hasDemo = cloudScans.some((s) => s.repo === CLOUD_DEMO_REPO);
    const hasRepo = hasRealCloudScan();
    markGuideSteps('cloudGuideSteps', {
      demo: !shouldShowCloudDemo() || hasDemo || cloudScans.length > 0,
      repo: hasRepo,
      fix: false,
      protect: protectRules.some((r) => r.findingRuleId),
    });
  }

  function updateAttackGuideSteps() {
    markGuideSteps('attackGuideSteps', {
      url: attackScans.length > 0,
      probe: attackScans.some((s) => s.status === 'complete'),
      fix: false,
      protect: protectRules.some((r) => r.findingRuleId),
    });
  }

  function updateProtectGuideSteps() {
    const hasOtherScans = cloudScans.length > 0 || attackScans.length > 0
      || (window.aegisHasCodeScans?.() ?? false);
    markGuideSteps('protectGuideSteps', {
      scan: hasOtherScans,
      sync: protectRules.some((r) => r.source !== 'builtin'),
      toggle: protectRules.some((r) => !r.enabled),
      test: protectEvents.length > 0 || (protectRules.some((r) => r.blocked > 0)),
    });
  }

  function hasRealCloudScan() {
    return cloudScans.some(
      (s) => s.status === 'complete' && s.repo && s.repo !== CLOUD_DEMO_REPO
    );
  }

  function shouldShowCloudDemo() {
    if (hasRealCloudScan()) return false;
    if (window.aegisIsProductionDeploy?.()) return false;
    return true;
  }

  function cloudScanEmptyMsg() {
    return shouldShowCloudDemo()
      ? 'Run a demo or scan a repo for Terraform, K8s, and Docker misconfigs'
      : 'Scan repository IaC for Terraform, K8s, and Docker misconfigs';
  }

  function updateCloudDemoUi() {
    const show = shouldShowCloudDemo();
    const demoBtn = $('#cloudDemoBtn');
    const scanBtn = $('#cloudScanOpenBtn');
    demoBtn?.classList.toggle('hidden', !show);
    $('#cloudGuideSteps [data-step="demo"]')?.classList.toggle('hidden', !show);
    $('#cloudHomeDemoNote')?.classList.toggle('hidden', !show);
    $('#cloudHomeProdNote')?.classList.toggle('hidden', show);
    if (scanBtn) {
      scanBtn.classList.toggle('btn-primary', !show);
      scanBtn.classList.toggle('btn-outline', show);
    }
  }

  function hasCloudScanData() {
    return cloudScans.some((s) => s.status === 'complete' || s.status === 'failed');
  }

  function hasAttackScanData() {
    return attackScans.some((s) => s.status === 'complete' || s.status === 'failed');
  }

  function hasProtectData() {
    return protectRules.length > 0;
  }

  function setModuleDataView(module, hasData) {
    $(`#${module}HomeWrap`)?.classList.toggle('hidden', hasData);
    $(`#${module}DataWrap`)?.classList.toggle('hidden', !hasData);
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function sevClass(sev) {
    return sev === 'critical' ? 'sev-critical' : sev === 'warning' ? 'sev-warning' : 'sev-info';
  }

  function sevLabel(sev) {
    return sev === 'critical' ? 'Critical' : sev === 'warning' ? 'High' : 'Info';
  }

  function renderModuleFindings(tbody, findings, emptyMsg, module, scanId) {
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!findings.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="repos-loading">${emptyMsg}</td></tr>`;
      return;
    }
    for (const f of findings) {
      const tr = document.createElement('tr');
      const guideBtn = module && scanId
        ? `<button type="button" class="btn-sm-outline fix-guide-btn" data-id="${escapeHtml(f.id)}" data-scan="${escapeHtml(scanId)}" data-module="${module}">Fix guide</button>`
        : '';
      tr.innerHTML = `
        <td><strong>${escapeHtml(f.title)}</strong><br><small style="color:var(--text-3)">${escapeHtml(f.message)}</small></td>
        <td><span class="branch-tag">${escapeHtml(f.file)}${f.line ? `:${f.line}` : ''}</span></td>
        <td><span class="sev-badge ${sevClass(f.severity)}">${sevLabel(f.severity)}</span></td>
        <td><span class="branch-tag">${escapeHtml(f.ruleId)}</span></td>
        <td>${guideBtn}</td>`;
      tbody.appendChild(tr);
    }
    tbody.querySelectorAll('.fix-guide-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.aegisOpenFixGuide?.(btn.dataset.id, btn.dataset.scan, btn.dataset.module);
      });
    });
  }

  function updateModuleKpis(prefix, scan) {
    const stats = scan?.stats;
    $(`#${prefix}Crit`) && (document.getElementById(`${prefix}Crit`).textContent = stats?.critical ?? '0');
    $(`#${prefix}Warn`) && (document.getElementById(`${prefix}Warn`).textContent = stats?.warning ?? '0');
    $(`#${prefix}Info`) && (document.getElementById(`${prefix}Info`).textContent = stats?.info ?? '0');
    $(`#${prefix}Score`) && (document.getElementById(`${prefix}Score`).textContent = stats?.score ?? '—');
  }

  function attackProbeEmptyMessage(scan) {
    const target = scan?.target ?? scan?.repo ?? 'target';
    const score = scan?.stats?.score ?? 100;
    return `Probe complete for ${target} — score ${score}. No security header issues detected.`;
  }

  function attackProbeToastMessage(res) {
    const scans = res.scans ?? [res];
    if (scans.length > 1) {
      const clean = scans.filter((s) => s.status === 'complete' && !(s.findings?.length)).length;
      const issues = scans.filter((s) => (s.findings?.length ?? 0) > 0).length;
      const failed = scans.filter((s) => s.status === 'failed').length;
      const parts = [`${scans.length} probes complete`];
      if (clean) parts.push(`${clean} clean`);
      if (issues) parts.push(`${issues} with findings`);
      if (failed) parts.push(`${failed} failed`);
      return parts.join(' — ');
    }
    const scan = scans[0];
    if (scan?.status === 'failed') return `Probe failed: ${scan.error || 'check the URL'}`;
    const count = scan.findings?.length ?? 0;
    const target = scan.target ?? scan.repo ?? 'target';
    if (!count) {
      return `Probe complete — ${target} scored ${scan.stats?.score ?? 100} (no issues)`;
    }
    return `Probe complete — ${count} finding(s) on ${target}`;
  }

  async function loadCloudScans() {
    cloudScans = await window.aegisApi('/api/cloud/scans');
    return cloudScans;
  }

  async function loadAttackScans() {
    attackScans = await window.aegisApi('/api/attack/scans');
    return attackScans;
  }

  function mergeAttackScans(fresh) {
    for (const scan of fresh) {
      if (!scan?.id) continue;
      const idx = attackScans.findIndex((s) => s.id === scan.id);
      if (idx >= 0) attackScans[idx] = scan;
      else attackScans.push(scan);
    }
    attackScans.sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
  }

  function focusAttackResultsNav() {
    $$('#navAttackModule .nav-item').forEach((n) => n.classList.remove('active'));
    $('#navAttackSurface')?.classList.add('active');
  }

  function paintAttackView(opts = {}) {
    const scans = attackScans;
    const hasData = hasAttackScanData();
    setModuleDataView('attack', hasData);
    const latest = scans[0];
    if (hasData && latest?.status === 'complete') {
      updateModuleKpis('attackStat', latest);
      const findings = latest.findings ?? [];
      renderModuleFindings(
        $('#attackFindingsList'),
        findings,
        attackProbeEmptyMessage(latest),
        'attack',
        latest.id
      );
      window.aegisSetPageContext?.(
        'Offensive testing',
        'Aegis Loop / attack',
        findings.length
          ? `${latest.target ?? latest.repo} · ${findings.length} finding(s) · score ${latest.stats?.score ?? '—'}`
          : `${latest.target ?? latest.repo} · probe passed · score ${latest.stats?.score ?? 100}`
      );
    } else if (hasData && latest?.status === 'failed') {
      renderModuleFindings($('#attackFindingsList'), [], latest.error || 'Probe failed', 'attack', latest.id);
      window.aegisSetPageContext?.('Offensive testing', 'Aegis Loop / attack', 'Last probe failed — check the URL');
    } else if (!hasData) {
      window.aegisSetPageContext?.('Offensive testing', 'Aegis Loop / attack', 'Safe passive probes — no destructive exploits');
    }

    const hist = $('#attackScanHistory');
    if (hist) {
      hist.innerHTML = scans.length
        ? scans.slice(0, 8).map((s) =>
            `<li data-id="${escapeHtml(s.id)}">${escapeHtml(s.target ?? s.repo)}<small>${s.stats?.critical ?? 0}c</small></li>`
          ).join('')
        : '<li class="scan-history-empty">No probes yet</li>';
      hist.querySelectorAll('li[data-id]').forEach((li) => {
        li.addEventListener('click', async () => {
          const scan = await window.aegisApi(`/api/attack/scans/${li.dataset.id}`);
          updateModuleKpis('attackStat', scan);
          const findings = scan.findings ?? [];
          renderModuleFindings(
            $('#attackFindingsList'),
            findings,
            findings.length ? 'No findings' : attackProbeEmptyMessage(scan),
            'attack',
            scan.id
          );
        });
      });
    }

    if (opts.scrollToResults && hasData) {
      focusAttackResultsNav();
      requestAnimationFrame(() => {
        $('#attackDataWrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }

  async function loadProtectData() {
    const data = await window.aegisApi('/api/protect/rules');
    protectRules = data.rules ?? [];
    const ev = await window.aegisApi('/api/protect/events');
    protectEvents = ev.events ?? [];
    return data;
  }

  async function renderCloudView() {
    $('#cloudView')?.classList.remove('hidden');
    try {
      const scans = await loadCloudScans();
      const hasData = hasCloudScanData();
      setModuleDataView('cloud', hasData);
      const latest = scans[0];
      if (hasData && latest?.status === 'complete') {
        updateModuleKpis('cloudStat', latest);
        renderModuleFindings($('#cloudFindingsList'), latest.findings ?? [], 'No misconfigurations found', 'cloud', latest.id);
        window.aegisSetPageContext?.(
          'Cloud posture',
          'Aegis Loop / cloud',
          `${latest.repo} · ${latest.findings?.length ?? 0} finding(s) · score ${latest.stats?.score ?? '—'}`
        );
      } else if (hasData && latest?.status === 'failed') {
        renderModuleFindings($('#cloudFindingsList'), [], latest.error || 'Cloud scan failed', 'cloud', latest.id);
        window.aegisSetPageContext?.('Cloud posture', 'Aegis Loop / cloud', 'Last scan failed — try again');
      } else if (!hasData) {
        window.aegisSetPageContext?.('Cloud posture', 'Aegis Loop / cloud', 'Scan IaC for public buckets, open security groups, and more');
      }
      await loadProtectData().catch(() => {});
      updateCloudGuideSteps();
      applyGuideVisibility('cloud');
      updateCloudDemoUi();
      const hist = $('#cloudScanHistory');
      if (hist) {
        hist.innerHTML = scans.length
          ? scans.slice(0, 8).map((s) =>
              `<li data-id="${escapeHtml(s.id)}">${escapeHtml(s.repo)}<small>${s.stats?.critical ?? 0}c · ${s.stats?.warning ?? 0}h</small></li>`
            ).join('')
          : '<li class="scan-history-empty">No cloud scans yet</li>';
        hist.querySelectorAll('li[data-id]').forEach((li) => {
          li.addEventListener('click', async () => {
            const scan = await window.aegisApi(`/api/cloud/scans/${li.dataset.id}`);
            updateModuleKpis('cloudStat', scan);
            renderModuleFindings($('#cloudFindingsList'), scan.findings ?? [], 'No findings', 'cloud', scan.id);
          });
        });
      }
    } catch (e) {
      window.aegisToast?.(e.message || 'Could not load cloud scans');
    }
  }

  async function renderAttackView(opts = {}) {
    $('#attackView')?.classList.remove('hidden');
    try {
      if (opts.freshScans?.length) mergeAttackScans(opts.freshScans);
      if (!opts.skipFetch) {
        await loadAttackScans();
      }
      paintAttackView(opts);
      await loadProtectData().catch(() => {});
      updateAttackGuideSteps();
      applyGuideVisibility('attack');
    } catch (e) {
      if (attackScans.length) {
        paintAttackView(opts);
      } else {
        window.aegisToast?.(e.message || 'Could not load attack scans');
      }
    }
  }

  async function renderProtectView() {
    $('#protectView')?.classList.remove('hidden');
    try {
      const data = await loadProtectData();
      const hasData = hasProtectData();
      setModuleDataView('protect', hasData);
      const stats = data.stats ?? {};
      $('#protectStatRules').textContent = stats.rules ?? '0';
      $('#protectStatEnabled').textContent = stats.enabled ?? '0';
      $('#protectStatBlocked').textContent = stats.blocked ?? '0';

      const rulesBody = $('#protectRulesList');
      if (rulesBody && hasData) {
        rulesBody.innerHTML = protectRules.length
          ? protectRules.map((r) => `
              <tr>
                <td><strong>${escapeHtml(r.title)}</strong><br><small>${escapeHtml(r.description)}</small></td>
                <td><span class="branch-tag">${escapeHtml(r.source)}</span></td>
                <td><code class="protect-pattern">${escapeHtml(r.pattern.slice(0, 48))}${r.pattern.length > 48 ? '…' : ''}</code></td>
                <td>${r.blocked}</td>
                <td>
                  <button type="button" class="btn-sm-outline protect-toggle" data-id="${escapeHtml(r.id)}" data-enabled="${r.enabled ? '0' : '1'}">
                    ${r.enabled ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>`).join('')
          : '<tr><td colspan="5" class="repos-loading">Sync rules from Code, Cloud, and Attack findings</td></tr>';

        rulesBody.querySelectorAll('.protect-toggle').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const ruleId = btn.dataset.id;
            const enabling = btn.dataset.enabled === '1';
            btn.disabled = true;
            btn.textContent = enabling ? 'Enabling…' : 'Disabling…';
            try {
              const res = await window.aegisApi(
                `/api/protect/rules/${encodeURIComponent(ruleId)}`,
                {
                  method: 'PATCH',
                  body: JSON.stringify({ enabled: enabling }),
                }
              );
              const idx = protectRules.findIndex((r) => r.id === ruleId);
              if (idx >= 0 && res.rule) protectRules[idx] = res.rule;
              await renderProtectView();
              window.aegisToast?.(enabling ? 'Rule enabled' : 'Rule disabled');
            } catch (e) {
              window.aegisToast?.(e.message || 'Could not update rule');
            } finally {
              btn.disabled = false;
            }
          });
        });
      }

      const eventsBody = $('#protectEventsList');
      if (eventsBody && hasData) {
        eventsBody.innerHTML = protectEvents.length
          ? protectEvents.slice(0, 20).map((e) => `
              <tr>
                <td><span class="branch-tag">${escapeHtml(e.method)}</span> ${escapeHtml(e.path)}</td>
                <td>${escapeHtml(e.detail)}</td>
                <td><span class="branch-tag">${escapeHtml(e.ruleId)}</span></td>
                <td>${new Date(e.blockedAt).toLocaleString()}</td>
              </tr>`).join('')
          : '<tr><td colspan="4" class="repos-loading">No blocked requests yet — WAF is active on this dashboard</td></tr>';
      }

      window.aegisSetPageContext?.(
        'Runtime firewall',
        'Aegis Loop / protect',
        hasData
          ? `${stats.enabled ?? 0} rules active · ${stats.blocked ?? 0} blocks · live on /app and /api`
          : 'Sync rules from Code, Cloud, and Attack findings'
      );
      await Promise.all([loadCloudScans(), loadAttackScans()]).catch(() => {});
      updateProtectGuideSteps();
      applyGuideVisibility('protect');
    } catch (e) {
      window.aegisToast?.(e.message || 'Could not load protect rules');
    }
  }

  function hideModuleViews() {
    ['cloudView', 'attackView', 'protectView'].forEach((id) => {
      $(`#${id}`)?.classList.add('hidden');
    });
  }

  function setModuleNav(moduleId) {
    Object.entries(MODULE_NAV).forEach(([mod, navId]) => {
      $(`#${navId}`)?.classList.toggle('hidden', mod !== moduleId);
    });
    $$('.module-pill').forEach((pill) => {
      const on = pill.dataset.module === moduleId;
      pill.classList.toggle('active', on);
      pill.classList.remove('module-soon');
      pill.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

async function switchModule(moduleId) {
  if ((moduleId === 'cloud' || moduleId === 'attack' || moduleId === 'protect') && !window.aegisIsTeamPlan?.()) {
    const labels = { cloud: 'Cloud', attack: 'Attack', protect: 'Protect' };
    window.aegisToast?.(`${labels[moduleId] || moduleId} requires Team plan — upgrade in Settings`);
    return;
  }
  activeModule = moduleId;
    setModuleNav(moduleId);
    hideModuleViews();
    window.aegisHideAllPanels?.();

    if (moduleId === 'code') {
      window.aegisShowFeedView?.();
      updateShowGuideButtons();
      return;
    }

    $$('.nav-item').forEach((n) => n.classList.remove('active'));
    $('#statsStrip')?.classList.add('hidden');
    $('#overviewCharts')?.classList.add('hidden');

    if (moduleId === 'cloud') {
      await renderCloudView();
    } else if (moduleId === 'attack') {
      await renderAttackView();
    } else if (moduleId === 'protect') {
      await renderProtectView();
    }

    history.replaceState(null, '', `/app/?module=${moduleId}`);
    updateShowGuideButtons();
  }

  async function runCloudDemo() {
    const btn = $('#cloudDemoBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Scanning…'; }
    try {
      await window.aegisApi('/api/cloud/scans/demo', { method: 'POST' });
      await renderCloudView();
      window.aegisToast?.('Cloud demo scan complete');
    } catch (e) {
      window.aegisToast?.(e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Run demo scan'; }
    }
  }

  async function runCloudRepoScan() {
    const repo = $('#cloudRepoInput')?.value.trim();
    if (!repo) return window.aegisToast?.('Enter a repository');
    const btn = $('#cloudScanBtn');
    if (btn) btn.disabled = true;
    try {
      await window.aegisApi('/api/cloud/scans', {
        method: 'POST',
        body: JSON.stringify({ repo, branch: $('#cloudBranchInput')?.value.trim() || 'main' }),
      });
      $('#cloudScanModal')?.classList.add('hidden');
      await renderCloudView();
      window.aegisToast?.('Cloud scan complete');
    } catch (e) {
      window.aegisToast?.(e.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function ensureAttackModuleVisible() {
    if (activeModule !== 'attack') {
      await switchModule('attack');
      return;
    }
    $('#attackView')?.classList.remove('hidden');
  }

  async function runAttackProbe() {
    const raw = $('#attackTargetInput')?.value.trim();
    if (!raw) return window.aegisToast?.('Enter at least one URL');
    const lines = raw.split(/[\n,]+/).map((l) => l.trim()).filter(Boolean);
    const btn = $('#attackProbeBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Probing…'; }
    try {
      await ensureAttackModuleVisible();
      const body = lines.length > 1 ? { targets: lines } : { target: lines[0] };
      const res = await window.aegisApi('/api/attack/scans', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const freshScans = (res.scans ?? [res]).filter((s) => s?.id);
      $('#attackTargetInput').value = '';
      $('#attackProbeModal')?.classList.add('hidden');
      await renderAttackView({ freshScans, skipFetch: true, scrollToResults: true });
      window.aegisToast?.(attackProbeToastMessage(res));
      loadAttackScans()
        .then(() => renderAttackView({ skipFetch: true }))
        .catch(() => {});
    } catch (e) {
      window.aegisToast?.(e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Run probe(s)'; }
    }
  }

  async function exportProtectRules() {
    try {
      const res = await fetch(`${window.location.origin}/api/protect/rules/export`, { credentials: 'include' });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'aegis-protect-rules.json';
      a.click();
      URL.revokeObjectURL(url);
      window.aegisToast?.('Rules exported');
    } catch (e) {
      window.aegisToast?.(e.message || 'Could not export rules');
    }
  }

  async function syncProtectRules() {
    const btn = $('#protectSyncBtn');
    if (btn) btn.disabled = true;
    try {
      await window.aegisApi('/api/protect/sync', { method: 'POST' });
      await renderProtectView();
      window.aegisToast?.('Rules synced from Code, Cloud, and Attack findings');
    } catch (e) {
      window.aegisToast?.(e.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function demoProtectBlock() {
    try {
      const res = await window.aegisApi('/api/protect/demo', {
        method: 'POST',
        body: JSON.stringify({ payload: "' OR 1=1 --" }),
      });
      window.aegisToast?.(res.blocked ? 'Blocked by Protect' : res.message);
    } catch (e) {
      window.aegisToast?.('Blocked by Protect — rule matched');
      await renderProtectView();
    }
  }

  function bindModuleEvents() {
    $('#cloudDemoBtn')?.addEventListener('click', runCloudDemo);
    $('#cloudScanOpenBtn')?.addEventListener('click', () => $('#cloudScanModal')?.classList.remove('hidden'));
    $('#cloudScanBtn')?.addEventListener('click', (e) => { e.preventDefault(); runCloudRepoScan(); });
    $$('[data-close-cloud-scan]').forEach((el) => el.addEventListener('click', () => $('#cloudScanModal')?.classList.add('hidden')));
    $('#attackProbeOpenBtn')?.addEventListener('click', () => $('#attackProbeModal')?.classList.remove('hidden'));
    $('#attackProbeBtn')?.addEventListener('click', (e) => { e.preventDefault(); runAttackProbe(); });
    $$('[data-close-attack-probe]').forEach((el) => el.addEventListener('click', () => $('#attackProbeModal')?.classList.add('hidden')));
    $('#navCloudScan')?.addEventListener('click', (e) => {
      e.preventDefault();
      $('#cloudScanModal')?.classList.remove('hidden');
    });
    $('#navAttackProbe')?.addEventListener('click', async (e) => {
      e.preventDefault();
      await ensureAttackModuleVisible();
      $('#attackProbeModal')?.classList.remove('hidden');
    });
    $('#navCloudPosture')?.addEventListener('click', (e) => {
      e.preventDefault();
      renderCloudView();
    });
    $('#navAttackSurface')?.addEventListener('click', (e) => {
      e.preventDefault();
      renderAttackView();
    });
    $('#navProtectRules')?.addEventListener('click', (e) => {
      e.preventDefault();
      renderProtectView();
    });
    $('#navProtectEvents')?.addEventListener('click', (e) => {
      e.preventDefault();
      renderProtectView();
      document.getElementById('protectEventsList')?.scrollIntoView({ behavior: 'smooth' });
    });
    $('#protectSyncBtn')?.addEventListener('click', syncProtectRules);
    $('#protectExportBtn')?.addEventListener('click', exportProtectRules);
    $('#protectDemoBtn')?.addEventListener('click', demoProtectBlock);

    $$('.module-guide-dismiss').forEach((btn) => {
      btn.addEventListener('click', () => dismissGuide(btn.dataset.guide));
    });
    $$('.module-show-guide').forEach((btn) => {
      btn.addEventListener('click', () => revealGuide(btn.dataset.guide));
    });
    $('#navCloudGuide')?.addEventListener('click', (e) => {
      e.preventDefault();
      revealGuide('cloud');
    });
    $('#navAttackGuide')?.addEventListener('click', (e) => {
      e.preventDefault();
      revealGuide('attack');
    });
    $('#navProtectGuide')?.addEventListener('click', (e) => {
      e.preventDefault();
      revealGuide('protect');
    });
    $$('.module-guide-doc-link').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const section = link.dataset.docsSection;
        window.aegisShowDocsView?.(section);
      });
    });

    ['overview', 'cloud', 'attack', 'protect'].forEach((mod) => applyGuideVisibility(mod));
  }

  window.AegisModules = {
    switchModule,
    getActiveModule: () => activeModule,
    hideModuleViews,
    bindModuleEvents,
    renderProtectView,
    applyGuideVisibility,
    revealGuide,
    updateShowGuideButtons,
    updateCloudDemoUi,
  };
})();
