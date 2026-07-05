import type { AegisModule, Finding, ProtectRule } from '../../types.js';

export const BUILTIN_RULES: ProtectRule[] = [
  {
    id: 'protect/sqli-union',
    source: 'builtin',
    title: 'SQL injection (UNION SELECT)',
    pattern: 'union\\s+select|or\\s+1\\s*=\\s*1',
    description: 'Blocks common SQLi probe patterns in query strings and bodies.',
    enabled: true,
    blocked: 0,
  },
  {
    id: 'protect/xss-script',
    source: 'builtin',
    title: 'Cross-site scripting (script tag)',
    pattern: '<script|javascript:',
    description: 'Blocks inline script injection attempts.',
    enabled: true,
    blocked: 0,
  },
  {
    id: 'protect/path-traversal',
    source: 'builtin',
    title: 'Path traversal',
    pattern: '\\.\\./|\\.\\.\\\\',
    description: 'Blocks directory traversal sequences.',
    enabled: true,
    blocked: 0,
  },
];

const FINDING_RULE_MAP: Record<string, Omit<ProtectRule, 'id' | 'enabled' | 'blocked' | 'findingRuleId'>> = {
  'secret/aws-key': {
    source: 'code',
    title: 'Block AWS key patterns',
    pattern: 'AKIA[0-9A-Z]{16}',
    description: 'Derived from Code secret findings — blocks AWS access key patterns in requests.',
  },
  'injection/sql': {
    source: 'code',
    title: 'Block SQL injection payloads',
    pattern: 'union\\s+select|;\\s*drop\\s+table',
    description: 'Derived from Code SQLi findings.',
  },
  'cloud/sg-open-world': {
    source: 'cloud',
    title: 'Block SSRF to metadata IP',
    pattern: '169\\.254\\.169\\.254|metadata\\.google',
    description: 'Derived from Cloud posture — blocks cloud metadata SSRF probes.',
  },
  'attack/plain-http': {
    source: 'attack',
    title: 'Block mixed-content downgrade',
    pattern: 'http://(?!localhost)',
    description: 'Derived from Attack surface scans — blocks cleartext URL patterns in payloads.',
  },
};

export function findingToRule(
  finding: Finding,
  module: AegisModule
): ProtectRule | null {
  const mapped = FINDING_RULE_MAP[finding.ruleId];
  if (!mapped) return null;
  return {
    id: `protect/${finding.ruleId}`,
    ...mapped,
    source: module,
    findingRuleId: finding.ruleId,
    enabled: true,
    blocked: 0,
  };
}
