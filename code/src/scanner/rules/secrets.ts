import type { FindingDraft, ScanRule } from '../../types.js';

const SECRET_PATTERNS: Array<{
  id: string;
  severity: FindingDraft['severity'];
  title: string;
  regex: RegExp;
  envVar: string;
}> = [
  {
    id: 'aws-access-key',
    severity: 'critical',
    title: 'Hardcoded AWS access key',
    regex: /AKIA[0-9A-Z]{16}/,
    envVar: 'AWS_ACCESS_KEY_ID',
  },
  {
    id: 'stripe-secret',
    severity: 'critical',
    title: 'Hardcoded Stripe secret key',
    regex: /sk_live_[0-9a-zA-Z]{16,}/,
    envVar: 'STRIPE_SECRET_KEY',
  },
  {
    id: 'generic-api-key',
    severity: 'critical',
    title: 'Hardcoded API key',
    regex: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    envVar: 'API_KEY',
  },
  {
    id: 'hardcoded-password',
    severity: 'critical',
    title: 'Hardcoded password',
    regex: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/i,
    envVar: 'PASSWORD',
  },
];

function buildAutofix(line: string, envVar: string) {
  const quoted = line.match(/(['"])([^'"]+)\1/);
  if (!quoted) return undefined;

  const fixedLine = line.replace(
    quoted[0],
    `process.env.${envVar} ?? '' /* moved to env */`
  );

  return {
    description: `Replace hardcoded value with process.env.${envVar}`,
    originalLine: line.trim(),
    fixedLine: fixedLine.trim(),
    patchedFile: '',
  };
}

export const secretsRule: ScanRule = {
  id: 'secrets',
  title: 'Secret detection',
  run(ctx) {
    const findings: FindingDraft[] = [];
    const exts = ['.ts', '.js', '.tsx', '.jsx', '.py', '.go', '.env.example'];

    for (const file of ctx.listFiles()) {
      if (!exts.some((ext) => file.endsWith(ext))) continue;
      const content = ctx.readFile(file);
      if (!content) continue;

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith('//') || line.includes('process.env')) continue;

        for (const pattern of SECRET_PATTERNS) {
          if (!pattern.regex.test(line)) continue;

          const autofixBase = buildAutofix(line, pattern.envVar);
          const patchedLines = [...lines];
          if (autofixBase) {
            patchedLines[i] = lines[i].replace(
              /(['"])([^'"]+)\1/,
              `process.env.${pattern.envVar} ?? '' /* moved to env */`
            );
          }

          findings.push({
            severity: pattern.severity,
            ruleId: pattern.id,
            title: pattern.title,
            file,
            line: i + 1,
            message: `Secret material detected in source. Move to environment variables or a secrets manager.`,
            snippet: line.trim(),
            autofix: autofixBase
              ? { ...autofixBase, patchedFile: patchedLines.join('\n') }
              : undefined,
          });
          break;
        }
      }
    }

    return findings;
  },
};
