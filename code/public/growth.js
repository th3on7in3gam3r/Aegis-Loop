const API = window.location.origin;

function $(sel, root = document) {
  return root.querySelector(sel);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatKind(kind) {
  return ({
    signup: 'Signups',
    login: 'Logins',
    checkout_intent: 'Checkout started',
    contact: 'Contact form',
    pricing_click: 'Pricing CTA clicks',
  })[kind] || kind;
}

function renderVisitorChart(days) {
  const el = $('#growthVisitorChart');
  if (!el || !days.length) {
    if (el) el.innerHTML = '<p class="growth-empty">No visitor data in this period.</p>';
    return;
  }
  const max = Math.max(...days.map((d) => d.visitors), 1);
  el.innerHTML = days
    .map((d) => {
      const h = Math.max(8, Math.round((d.visitors / max) * 100));
      const label = d.date.slice(5);
      return `<div class="growth-bar-col" title="${escapeHtml(d.date)}: ${d.visitors} visitors">
        <div class="growth-bar" style="height:${h}%"></div>
        <span class="growth-bar-label">${escapeHtml(label)}</span>
      </div>`;
    })
    .join('');
}

function renderChannels(channels) {
  const el = $('#growthChannels');
  if (!el) return;
  if (!channels.length) {
    el.innerHTML = '<p class="growth-empty">No channel data yet.</p>';
    return;
  }
  el.innerHTML = channels
    .map(
      (c) => `<div class="growth-channel-row">
        <div class="growth-channel-meta">
          <strong>${escapeHtml(c.channel)}</strong>
          <span>${c.visitors} visitors · ${c.share}%</span>
        </div>
        <div class="growth-channel-bar"><span style="width:${c.share}%"></span></div>
      </div>`,
    )
    .join('');
}

function renderConversions(conversions) {
  const el = $('#growthConversions');
  if (!el) return;
  el.innerHTML = conversions
    .map(
      (c) => `<article class="growth-stat-card">
        <span class="growth-stat-val">${c.count}</span>
        <span class="growth-stat-label">${escapeHtml(formatKind(c.kind))}</span>
        <span class="growth-stat-sub">${c.rate}% of visitors</span>
      </article>`,
    )
    .join('');
}

function renderClicks(clicks) {
  const el = $('#growthClicks');
  if (!el) return;
  if (!clicks.length) {
    el.innerHTML = '<p class="growth-empty">No click events yet. CTAs on the marketing site are tracked automatically.</p>';
    return;
  }
  el.innerHTML = `<table class="growth-table">
    <thead><tr><th>Label</th><th>Page</th><th>Clicks</th></tr></thead>
    <tbody>${clicks
      .map(
        (c) => `<tr>
          <td>${escapeHtml(c.label)}</td>
          <td><code>${escapeHtml(c.path)}</code></td>
          <td>${c.clicks}</td>
        </tr>`,
      )
      .join('')}</tbody></table>`;
}

function renderHeatmap(cells, path) {
  const grid = $('#growthHeatmap');
  const meta = $('#growthHeatmapMeta');
  if (!grid) return;
  if (meta) meta.textContent = path || '/';
  if (!cells.length) {
    grid.innerHTML = '<p class="growth-empty">Heatmap fills in as visitors click on your marketing pages.</p>';
    return;
  }
  const max = Math.max(...cells.map((c) => c.count), 1);
  const parts = [];
  for (let y = 0; y < 20; y += 1) {
    for (let x = 0; x < 20; x += 1) {
      const cell = cells.find((c) => c.x === x && c.y === y);
      const intensity = cell ? cell.count / max : 0;
      const alpha = intensity ? 0.15 + intensity * 0.85 : 0;
      parts.push(`<div class="growth-heat-cell" style="background:rgba(124,58,237,${alpha.toFixed(2)})" title="${cell ? cell.count + ' clicks' : ''}"></div>`);
    }
  }
  grid.innerHTML = parts.join('');
}

function renderPages(pages) {
  const el = $('#growthPages');
  if (!el) return;
  if (!pages.length) {
    el.innerHTML = '<p class="growth-empty">No page engagement data yet.</p>';
    return;
  }
  el.innerHTML = pages
    .map(
      (p) => `<div class="growth-page-row">
        <code>${escapeHtml(p.path)}</code>
        <span>${p.pageviews} views</span>
        <span>${p.avgScroll}% scroll</span>
        <span class="growth-grade growth-grade-${p.grade === '—' ? 'na' : p.grade.toLowerCase()}">${escapeHtml(p.grade)}</span>
      </div>`,
    )
    .join('');
}

function renderInsights(insights) {
  const el = $('#growthInsights');
  if (!el) return;
  if (!insights.length) {
    el.innerHTML = '<p class="growth-empty">Insights appear once you have visitor data.</p>';
    return;
  }
  el.innerHTML = insights
    .map(
      (i) => `<article class="growth-insight growth-insight-${i.severity}">
        <strong>${escapeHtml(i.title)}</strong>
        <p>${escapeHtml(i.detail)}</p>
      </article>`,
    )
    .join('');
}

export async function renderGrowthPanel() {
  const root = $('#growthView');
  if (!root) return;
  const days = Number($('#growthDaysSelect')?.value || 7);
  root.querySelector('.growth-loading')?.classList.remove('hidden');
  root.querySelectorAll('.growth-error').forEach((el) => el.remove());
  try {
    const data = await fetch(`${API}/api/analytics/summary?days=${days}`, { credentials: 'include' }).then((r) => {
      if (!r.ok) throw new Error('Failed to load analytics');
      return r.json();
    });

    $('#growthSiteGrade').textContent = data.siteGrade || '—';
    $('#growthVisitors').textContent = String(data.visitors ?? 0);
    $('#growthPageviews').textContent = String(data.pageviews ?? 0);
    $('#growthEngagement').textContent = `${data.engagementChange >= 0 ? '+' : ''}${data.engagementChange ?? 0}%`;
    $('#growthSessions').textContent = String(data.sessions ?? 0);

    renderVisitorChart(data.visitorsByDay || []);
    renderChannels(data.channels || []);
    renderConversions(data.conversions || []);
    renderClicks(data.topClicks || []);
    renderHeatmap(data.heatmap || [], data.heatmapPath);
    renderPages(data.pages || []);
    renderInsights(data.insights || []);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not load analytics';
    root.querySelector('.growth-body')?.insertAdjacentHTML(
      'afterbegin',
      `<p class="growth-error">${escapeHtml(msg)} — sign in and ensure cookie consent is accepted on the marketing site.</p>`,
    );
  } finally {
    root.querySelector('.growth-loading')?.classList.add('hidden');
  }
}

export function showGrowthView() {
  if (typeof window.aegisHideAllPanels === 'function') window.aegisHideAllPanels();
  $('#growthView')?.classList.remove('hidden');
  if (typeof window.aegisSetPageContext === 'function') {
    window.aegisSetPageContext(
      'Growth analytics',
      'Aegis Loop · Growth',
      'Visitors, conversions, channels, clicks, heatmaps, and AI insights',
    );
  } else {
    $('#pageTitle').textContent = 'Growth analytics';
    $('#pageBreadcrumb').textContent = 'Aegis Loop · Growth';
    $('#scanMeta').textContent = 'Visitors, conversions, channels, clicks, heatmaps, and AI insights';
  }
  if (typeof window.aegisSetActiveNav === 'function') window.aegisSetActiveNav('navGrowth');
  if (typeof window.aegisSetModulePill === 'function') window.aegisSetModulePill('code');
  void renderGrowthPanel();
}

export function initGrowth() {
  $('#growthRefreshBtn')?.addEventListener('click', () => void renderGrowthPanel());
  $('#growthDaysSelect')?.addEventListener('change', () => void renderGrowthPanel());
}
