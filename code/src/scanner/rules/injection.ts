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

type QuoteState = { inTemplate: boolean; inSingle: boolean; inDouble: boolean };

function createQuoteState(): QuoteState {
  return { inTemplate: false, inSingle: false, inDouble: false };
}

/** Match eval() calls in executable code, not inside strings, templates, or comments. */
function lineHasUnsafeEval(line: string, state: QuoteState): boolean {
  let i = 0;
  while (i < line.length) {
    const ch = line[i];

    if (!state.inTemplate && !state.inSingle && !state.inDouble && ch === '/' && line[i + 1] === '/') {
      break;
    }

    if ((state.inSingle || state.inDouble || state.inTemplate) && ch === '\\') {
      i += 2;
      continue;
    }

    if (!state.inSingle && !state.inDouble && ch === '`') {
      state.inTemplate = !state.inTemplate;
      i++;
      continue;
    }

    if (!state.inTemplate && !state.inDouble && ch === "'") {
      state.inSingle = !state.inSingle;
      i++;
      continue;
    }

    if (!state.inTemplate && !state.inSingle && ch === '"') {
      state.inDouble = !state.inDouble;
      i++;
      continue;
    }

    if (!state.inTemplate && !state.inSingle && !state.inDouble && /^\beval\s*\(/.test(line.slice(i))) {
      return true;
    }

    i++;
  }

  return false;
}

const UNSAFE_EVAL_TITLE = 'Unsafe dynamic code execution';

function isScannerRuleSource(file: string): boolean {
  return /scanner[/\\]rules[/\\]/.test(file);
}

export const injectionRule: ScanRule = {
  id: 'injection',
  title: 'Injection patterns',
  run(ctx) {
    const findings: FindingDraft[] = [];
    const codeExts = ['.ts', '.js', '.tsx', '.jsx'];

    for (const file of ctx.listFiles()) {
      if (!codeExts.some((ext) => file.endsWith(ext))) continue;
      if (isScannerRuleSource(file)) continue;
      const content = ctx.readFile(file);
      if (!content) continue;

      const lines = content.split('\n');
      const quoteState = createQuoteState();
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

        if (lineHasUnsafeEval(line, quoteState)) {
          findings.push({
            severity: 'warning',
            ruleId: 'unsafe-eval',
            title: UNSAFE_EVAL_TITLE,
            file,
            line: i + 1,
            message: 'Dynamic code execution via eval is a common RCE vector.',
            snippet: line.trim(),
          });
        }
      }
    }

    return findings;
  },
};
