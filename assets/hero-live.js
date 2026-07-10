(function () {
  const dash = document.getElementById('heroDash');
  if (!dash) return;

  const els = {
    repo: document.getElementById('heroRepoTitle'),
    status: document.getElementById('heroStatus'),
    scanTime: document.getElementById('heroScanTime'),
    crit: document.getElementById('heroCrit'),
    warn: document.getElementById('heroWarn'),
    info: document.getElementById('heroInfo'),
    score: document.getElementById('heroScore'),
    findings: document.getElementById('heroFindings'),
    codeBadge: document.getElementById('heroCodeBadge'),
    rescan: document.getElementById('heroRescanBtn'),
    openApp: document.getElementById('heroOpenApp'),
    note: document.getElementById('heroLiveNote'),
  };

  let appHref = '/login?next=' + encodeURIComponent('/app/');

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sevLabel(severity) {
    if (severity === 'critical') return { cls: 'sev-crit', text: 'CRIT' };
    if (severity === 'warning') return { cls: 'sev-warn', text: 'WARN' };
    return { cls: 'sev-ok', text: 'INFO' };
  }

  function relTime(iso) {
    if (!iso) return 'just now';
    const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (sec < 8) return 'just now';
    if (sec < 60) return sec + 's ago';
    const min = Math.floor(sec / 60);
    if (min < 60) return min + 'm ago';
    return Math.floor(min / 60) + 'h ago';
  }

  function animateVal(el, target) {
    if (!el) return;
    const duration = 700;
    const start = performance.now();
    const from = 0;
    function tick(now) {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(from + (target - from) * eased));
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function setLoading(loading) {
    dash.classList.toggle('is-loading', loading);
    if (loading) {
      els.status.innerHTML = '<span class="status-dot"></span> Scanning…';
      els.rescan.disabled = true;
      els.rescan.textContent = '↻ Scanning…';
    } else {
      els.rescan.disabled = false;
      els.rescan.textContent = '↻ Rescan';
    }
  }

  function sortedFindings(findings) {
    const rank = { critical: 0, warning: 1, info: 2 };
    return [...findings]
      .filter((f) => !f.fixed)
      .sort((a, b) => {
        const d = (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9);
        return d !== 0 ? d : a.title.localeCompare(b.title);
      });
  }

  function renderScan(scan) {
    const stats = scan.stats || {};
    const openCount = (stats.critical || 0) + (stats.warning || 0);

    if (els.repo) els.repo.textContent = scan.repo || 'aegis-loop/sample-app';
    els.status.innerHTML = '<span class="status-dot"></span> Scan complete';
    els.scanTime.textContent = 'Last scan · ' + relTime(scan.completedAt || scan.startedAt);

    animateVal(els.crit, stats.critical || 0);
    animateVal(els.warn, stats.warning || 0);
    animateVal(els.info, stats.info || 0);
    animateVal(els.score, stats.score || 0);

    if (els.codeBadge) {
      if (openCount > 0) {
        els.codeBadge.textContent = String(openCount);
        els.codeBadge.classList.remove('hidden');
      } else {
        els.codeBadge.classList.add('hidden');
      }
    }

    const top = sortedFindings(scan.findings || []).slice(0, 4);
    if (!top.length) {
      els.findings.innerHTML =
        '<div class="hero-live-error">No findings in sample repo — the scanner may still be warming up. Try Rescan.</div>';
      return;
    }

    els.findings.innerHTML = top
      .map((f) => {
        const sev = sevLabel(f.severity);
        const loc = f.line > 0 ? esc(f.file) + ':' + f.line : esc(f.file);
        const action = f.autofix || f.remediation ? 'A-Fix in app →' : 'View in app →';
        const meta = esc(f.ruleId) + ' · ' + loc;
        return (
          '<div class="finding">' +
          '<div class="finding-left">' +
          '<span class="sev ' + sev.cls + '">' + sev.text + '</span>' +
          '<div><div class="finding-title">' + esc(f.title) + '</div>' +
          '<div class="finding-meta">' + meta + '</div></div></div>' +
          '<a class="finding-action" href="' + appHref + '">' + action + '</a>' +
          '</div>'
        );
      })
      .join('');

    if (els.note) {
      const n = scan.findings?.length || 0;
      els.note.textContent =
        n + ' finding' + (n === 1 ? '' : 's') +
        ' on the free sample repo · start free to scan your GitHub repos';
    }
  }

  function renderError(message) {
    els.status.innerHTML = '<span class="status-dot" style="background:var(--red)"></span> Scan failed';
    els.scanTime.textContent = 'Could not run live demo';
    els.findings.innerHTML = '<div class="hero-live-error">' + esc(message) + '</div>';
  }

  async function loadDemo(refresh) {
    setLoading(true);
    try {
      const url = refresh ? '/api/demo/preview?refresh=1' : '/api/demo/preview';
      const res = await fetch(url, { credentials: 'same-origin' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Demo scan failed');
      renderScan(data);
    } catch (err) {
      renderError(err.message || 'Demo scan failed');
    } finally {
      setLoading(false);
    }
  }

  if (els.rescan) {
    els.rescan.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      loadDemo(true);
    });
  }

  fetch('/api/auth/me', { credentials: 'include' })
    .then((r) => (r.ok ? r.json() : { connected: false }))
    .then((data) => {
      if (data.connected) {
        appHref = '/app/';
        if (els.openApp) {
          els.openApp.href = '/app/';
          els.openApp.textContent = 'Open your dashboard →';
        }
      }
    })
    .catch(() => {})
    .finally(() => loadDemo(false));
})();
