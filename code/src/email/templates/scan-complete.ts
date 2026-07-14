import type { AegisModule, ScanResult } from '../../types.js';
import { EMAIL_BRAND, appDashboardUrl, scanDashboardUrl } from '../config.js';
import {
  buildEmailShell,
  emailBulletList,
  emailSectionTitle,
  emailStatCard,
  emailTagRow,
  escapeHtml,
} from './base-layout.js';

export type ScanCompleteEmailInput = {
  scan: Pick<ScanResult, 'id' | 'module' | 'repo' | 'branch' | 'target' | 'stats' | 'findings'>;
  topFindings: string[];
  previousScore?: number | null;
  variant?: 'complete' | 'score_drop';
};

const MODULE_LABELS: Record<AegisModule, string> = {
  code: 'Code',
  cloud: 'Cloud',
  attack: 'Attack',
  protect: 'Protect',
};

function scoreAccent(score: number): string {
  if (score >= 80) return '#10b981';
  if (score >= 60) return '#f59e0b';
  return '#ef4444';
}

function scanTargetLabel(scan: ScanCompleteEmailInput['scan']): string {
  if (scan.module === 'attack' && scan.target) return scan.target;
  if (scan.branch && scan.branch !== 'main') return `${scan.repo} (${scan.branch})`;
  return scan.repo;
}

function scoreDeltaHint(score: number, previousScore: number | null | undefined): string | undefined {
  if (previousScore == null) return undefined;
  const delta = score - previousScore;
  if (delta > 0) {
    return `<span style="color:#10b981;font-weight:700">▲ +${delta}</span> vs last scan`;
  }
  if (delta < 0) {
    return `<span style="color:#ef4444;font-weight:700">▼ ${delta}</span> vs last scan`;
  }
  return `<span style="color:#64748b">No change</span> vs last scan`;
}

function severitySummary(stats: ScanResult['stats']): string {
  const parts: string[] = [];
  if (stats.critical) parts.push(`${stats.critical} critical`);
  if (stats.warning) parts.push(`${stats.warning} warning`);
  if (stats.info) parts.push(`${stats.info} info`);
  return parts.length ? parts.join(' · ') : 'No open findings';
}

function buildBodyHtml(input: ScanCompleteEmailInput, primaryColor: string): string {
  const { scan, topFindings } = input;
  const mod = scan.module ?? 'code';
  const modLabel = MODULE_LABELS[mod];
  const target = scanTargetLabel(scan);
  const accent = scoreAccent(scan.stats.score);

  const parts: string[] = [
    emailStatCard({
      label: 'Security score',
      value: `${scan.stats.score}`,
      hint: [scoreDeltaHint(scan.stats.score, input.previousScore), 'out of 100']
        .filter(Boolean)
        .join(' · '),
      accent,
    }),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0 0">
<tr><td style="padding:14px 18px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px">
<p style="margin:0;font-size:13px;color:#64748b"><strong style="color:#0f172a">${escapeHtml(severitySummary(scan.stats))}</strong></p>
</td></tr></table>`,
  ];

  if (input.variant === 'score_drop' && input.previousScore != null) {
    parts.push(
      `<p style="margin:20px 0 0;padding:14px 16px;background:#fef2f2;border:1px solid #fecaca;border-radius:12px;font-size:14px;line-height:1.55;color:#991b1b">Your score moved from <strong>${input.previousScore}</strong> to <strong>${scan.stats.score}</strong>. Review the findings below and apply A-Fix or remediation guides before shipping.</p>`
    );
  }

  if (topFindings.length > 0) {
    parts.push(emailSectionTitle('Top findings'), emailBulletList(topFindings, primaryColor));
  }

  parts.push(
    emailSectionTitle('What to do next'),
    emailTagRow(['Review findings', 'Apply A-Fix', 'Sync Protect rules']),
    `<p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#64748b">Your <strong style="color:#0f172a">${escapeHtml(modLabel)}</strong> scan for <strong style="color:#0f172a">${escapeHtml(target)}</strong> is ready in Aegis Loop — open the dashboard for autofix, PR comments, and cross-module Protect coverage.</p>`
  );

  return parts.join('');
}

function buildPlainText(input: ScanCompleteEmailInput): string {
  const { scan, topFindings } = input;
  const mod = scan.module ?? 'code';
  const target = scanTargetLabel(scan);
  const lines = [
    input.variant === 'score_drop'
      ? `Score alert — ${target}`
      : `${MODULE_LABELS[mod]} scan complete — ${target}`,
    '',
    `Security score: ${scan.stats.score}/100`,
    severitySummary(scan.stats),
  ];

  if (input.previousScore != null) {
    const delta = scan.stats.score - input.previousScore;
    lines.push(`Change vs last scan: ${delta >= 0 ? '+' : ''}${delta}`);
  }

  if (topFindings.length > 0) {
    lines.push('', 'Top findings:');
    topFindings.forEach((item, i) => lines.push(`${i + 1}. ${item}`));
  }

  lines.push('', `Open scan: ${scanDashboardUrl(scan)}`);
  lines.push(`Dashboard: ${appDashboardUrl()}`);

  return lines.join('\n');
}

export function scanCompleteSubject(input: ScanCompleteEmailInput): string {
  const target = scanTargetLabel(input.scan);
  const mod = MODULE_LABELS[input.scan.module ?? 'code'];
  if (input.variant === 'score_drop') {
    return `${mod} score dropped for ${target} (${input.scan.stats.score}/100)`;
  }
  return `${mod} scan complete — ${target} scored ${input.scan.stats.score}/100`;
}

export function buildScanCompleteEmail(input: ScanCompleteEmailInput): {
  html: string;
  text: string;
  subject: string;
} {
  const primaryColor = EMAIL_BRAND.primaryColor;
  const bodyHtml = buildBodyHtml(input, primaryColor);
  const isDrop = input.variant === 'score_drop';
  const target = scanTargetLabel(input.scan);
  const modLabel = MODULE_LABELS[input.scan.module ?? 'code'];

  const preheader = isDrop
    ? `${target} dropped to ${input.scan.stats.score}/100 — ${input.topFindings[0] ?? 'review findings in Aegis Loop'}`
    : `${target}: ${input.scan.stats.score}/100 · ${severitySummary(input.scan.stats)}`;

  return {
    subject: scanCompleteSubject(input),
    text: buildPlainText(input),
    html: buildEmailShell({
      preheader,
      title: isDrop ? `Score alert — ${target}` : `${modLabel} scan complete`,
      headerEyebrow: isDrop ? 'Security score alert' : `${modLabel} scan complete`,
      bodyHtml,
      primaryColor,
      logoAlt: EMAIL_BRAND.name,
      cta: {
        href: scanDashboardUrl(input.scan),
        label: 'Open scan results',
      },
      secondaryCta: {
        href: appDashboardUrl(),
        label: 'Open dashboard',
      },
    }),
  };
}

export function topFindingTitles(scan: ScanResult, limit = 5): string[] {
  const rank = { critical: 0, warning: 1, info: 2 };
  return [...scan.findings]
    .filter((f) => !f.fixed)
    .sort((a, b) => rank[a.severity] - rank[b.severity])
    .slice(0, limit)
    .map((f) => f.title);
}
