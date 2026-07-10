import type { Finding } from '../../types.js';
import { scanAttackTarget } from './scanner.js';

export type UrlCheckSummary = {
  url: string;
  status: 'complete' | 'failed';
  score: number;
  grade: 'A' | 'B' | 'C' | 'D';
  summary: string;
  https: boolean;
  hsts: boolean;
  csp: boolean;
  findingCount: { critical: number; warning: number; info: number };
  findings: { severity: Finding['severity']; title: string; message: string }[];
  reportUrl: string;
  marketerNote: string;
};

function gradeFromScore(score: number): UrlCheckSummary['grade'] {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 50) return 'C';
  return 'D';
}

export async function summarizeUrlCheck(targetInput: string): Promise<UrlCheckSummary> {
  const scan = await scanAttackTarget(targetInput);
  const findings = scan.findings ?? [];
  const critical = findings.filter((f) => f.severity === 'critical').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  const info = findings.filter((f) => f.severity === 'info').length;

  if (scan.status === 'failed') {
    return {
      url: scan.target,
      status: 'failed',
      score: 0,
      grade: 'D',
      summary: scan.error || 'Could not reach this URL',
      https: false,
      hsts: false,
      csp: false,
      findingCount: { critical: 0, warning: 0, info: 0 },
      findings: [],
      reportUrl: 'https://aegis-loop.com/',
      marketerNote:
        'This is a lightweight header check for marketers. Developers should use Aegis Loop for full repo and PR scanning.',
    };
  }

  const deductions = critical * 25 + warnings * 12 + info * 4;
  const score = Math.max(0, Math.min(100, 100 - deductions));

  return {
    url: scan.target,
    status: 'complete',
    score,
    grade: gradeFromScore(score),
    summary: `${critical} critical · ${warnings} warnings · ${info} informational`,
    https: !findings.some((f) => f.ruleId === 'attack/plain-http'),
    hsts: !findings.some((f) => f.ruleId === 'attack/missing-hsts'),
    csp: !findings.some((f) => f.ruleId === 'attack/missing-csp'),
    findingCount: { critical, warning: warnings, info },
    findings: findings.slice(0, 8).map((f) => ({
      severity: f.severity,
      title: f.title,
      message: f.message,
    })),
    reportUrl: 'https://aegis-loop.com/',
    marketerNote:
      'Surface check only — no exploitation. Connect GitHub in Aegis Loop for code, cloud IaC, and autofix PRs.',
  };
}
