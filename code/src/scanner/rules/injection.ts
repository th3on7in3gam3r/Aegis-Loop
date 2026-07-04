import type { FindingDraft, ScanRule } from '../../types.js';

function fixSqlInterpolation(line: string): { fixedLine: string; description: string } | null {
  const templateMatch = line.match(/(\.(?:query|execute|raw)\s*\(\s*)`([^`]*)\$\{(\w+)\}([^`]*)`/);
  if (templateMatch) {
    const [, callPrefix, before, varName, after] = templateMatch;
    const sql = `${before}$1${after}`.replace(/'\$1'/g, '$1').replace(/"\$1"/g, '$1');
    const replacement = `${callPrefix}'${sql}', [${varName}]`;
    return {
      fixedLine: line.replace(templateMatch[0], replacement).trim(),
      description: 'Replace string interpolation with parameterized query ($1 placeholder)',
    };
  }

  const concatMatch = line.match(/(\.(?:query|execute|raw)\s*\(\s*)['"]([^'"]*)['"]\s*\+/);
  if (concatMatch) {
    return {
      fixedLine: '// Use parameterized queries — e.g. db.query(\'... WHERE x = $1\', [value])',
      description: 'Replace string concatenation with parameterized query',
    };
  }

  return null;
}

export const injectionRule: ScanRule = {
  id: 'injection',
  title: 'Injection patterns',
  run(ctx) {
    const findings: FindingDraft[] = [];
    const codeExts = ['.ts', '.js', '.tsx', '.jsx'];

    for (const file of ctx.listFiles()) {
      if (!codeExts.some((ext) => file.endsWith(ext))) continue;
      const content = ctx.readFile(file);
      if (!content) continue;

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (
          /(?:query|execute|raw)\s*\(\s*[`'"].*\$\{/.test(line) ||
          /(?:query|execute|raw)\s*\([^)]*\+/.test(line)
        ) {
          const fix = fixSqlInterpolation(line);
          const patchedLines = [...lines];
          const indent = line.match(/^(\s*)/)?.[1] ?? '';

          if (fix) {
            patchedLines[i] = `${indent}${fix.fixedLine}`;
          } else {
            patchedLines[i] = `${indent}// TODO(aegis-loop): use parameterized queries`;
          }

          findings.push({
            severity: 'critical',
            ruleId: 'sql-injection',
            title: 'SQL injection risk',
            file,
            line: i + 1,
            message:
              'User input appears interpolated into a SQL query. Use parameterized queries or an ORM.',
            snippet: line.trim(),
            autofix: fix
              ? {
                  description: fix.description,
                  originalLine: line.trim(),
                  fixedLine: patchedLines[i].trim(),
                  patchedFile: patchedLines.join('\n'),
                }
              : undefined,
          });
        }

        if (/\beval\s*\(/.test(line)) {
          findings.push({
            severity: 'warning',
            ruleId: 'unsafe-eval',
            title: 'Unsafe eval() usage',
            file,
            line: i + 1,
            message: 'eval() executes arbitrary code and is a common RCE vector.',
            snippet: line.trim(),
          });
        }
      }
    }

    return findings;
  },
};
