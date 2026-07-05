import type { Finding, ScanStats } from '../types.js';

export function calcStats(findings: Finding[]): ScanStats {
  const open = findings.filter((f) => !f.fixed);
  const critical = open.filter((f) => f.severity === 'critical').length;
  const warning = open.filter((f) => f.severity === 'warning').length;
  const info = open.filter((f) => f.severity === 'info').length;
  const resolved = findings.filter((f) => f.fixed).length;
  const penalty = critical * 15 + warning * 5 + info;
  const score = Math.max(0, Math.min(100, 100 - penalty));
  return { critical, warning, info, resolved, score };
}
