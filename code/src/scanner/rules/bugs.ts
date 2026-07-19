import type { FindingDraft, ScanRule } from '../../types.js';

const CODE_EXTS = ['.ts', '.js', '.tsx', '.jsx'];

function isScannerRuleSource(file: string): boolean {
  return /scanner[/\\]rules[/\\]/.test(file);
}

function isTestFile(file: string): boolean {
  return /\.(test|spec)\.[jt]sx?$/i.test(file) || /[/\\](__tests__|tests?)[/\\]/i.test(file);
}

function codeOnly(line: string): string {
  let code = line.replace(/\/\/.*$/, '');
  code = code.replace(/'(?:\\.|[^'\\])*'/g, "''");
  code = code.replace(/"(?:\\.|[^'\\])*"/g, '""');
  code = code.replace(/`(?:\\.|[^`\\])*`/g, '``');
  return code;
}

/** Detect `=` assignment inside `if (...)`, ignoring == === != !== >= <= =>. */
export function hasAssignmentInIfCondition(code: string): boolean {
  const match = code.match(/\bif\s*\(([^)]*)\)/);
  if (!match) return false;
  // Single = not preceded by = ! < > and not followed by = or >
  return /(?<![=!<>])=(?![=>])/.test(match[1]);
}

function buildPatchedFile(lines: string[], lineIndex: number, newLine: string): string {
  const patched = [...lines];
  patched[lineIndex] = newLine;
  return patched.join('\n');
}

export const bugsRule: ScanRule = {
  id: 'bugs',
  title: 'Logic & correctness bugs',
  run(ctx) {
    const findings: FindingDraft[] = [];
    const seen = new Set<string>();

    const push = (draft: FindingDraft) => {
      const key = `${draft.file}:${draft.line}:${draft.ruleId}`;
      if (seen.has(key)) return;
      seen.add(key);
      findings.push(draft);
    };

    for (const file of ctx.listFiles()) {
      if (!CODE_EXTS.some((ext) => file.endsWith(ext))) continue;
      if (isScannerRuleSource(file) || isTestFile(file)) continue;

      const content = ctx.readFile(file);
      if (!content) continue;

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

        const code = codeOnly(line);
        const indent = line.match(/^(\s*)/)?.[1] ?? '';

        if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(code)) {
          const varMatch = code.match(/catch\s*\(\s*(\w+)\s*\)/);
          const varName = varMatch?.[1] ?? 'err';
          const fixedLine = line.replace(/\{\s*\}/, `{ console.error(${varName}); }`);
          push({
            severity: 'warning',
            ruleId: 'bug/empty-catch',
            title: 'Empty catch block swallows errors',
            file,
            line: i + 1,
            message:
              'Errors caught here are silently ignored, which hides failures in production and makes debugging painful.',
            snippet: line.trim(),
            autofix: {
              description: 'Log the error (or rethrow) instead of an empty catch body',
              originalLine: line.trim(),
              fixedLine: fixedLine.trim(),
              patchedFile: buildPatchedFile(lines, i, fixedLine),
            },
          });
        }

        if (/(?<![!=<>])==(?![=])/.test(code) && !/===/.test(code)) {
          const fixedLine = line.replace(/(?<![!=<>])==(?![=])/g, '===');
          push({
            severity: 'info',
            ruleId: 'bug/loose-equality',
            title: 'Loose equality (==)',
            file,
            line: i + 1,
            message:
              '== coerces types and can cause subtle bugs (e.g. 0 == false). Prefer strict === unless you explicitly need coercion.',
            snippet: line.trim(),
            autofix: {
              description: 'Replace == with === for strict equality',
              originalLine: line.trim(),
              fixedLine: fixedLine.trim(),
              patchedFile: buildPatchedFile(lines, i, fixedLine),
            },
          });
        }

        if (/\bparseInt\s*\(\s*[^,)]+\s*\)/.test(code) && !/\bparseInt\s*\([^)]+,\s*\d+/.test(code)) {
          const fixedLine = line.replace(/\bparseInt\s*\(\s*([^,)]+)\s*\)/, 'parseInt($1, 10)');
          push({
            severity: 'info',
            ruleId: 'bug/parseint-no-radix',
            title: 'parseInt without radix',
            file,
            line: i + 1,
            message:
              'parseInt without a radix can mis-parse strings with leading zeros (e.g. "08"). Pass 10 for decimal or 16 for hex.',
            snippet: line.trim(),
            autofix: {
              description: 'Add radix 10 to parseInt',
              originalLine: line.trim(),
              fixedLine: fixedLine.trim(),
              patchedFile: buildPatchedFile(lines, i, fixedLine),
            },
          });
        }

        if (/\bconsole\.(log|debug|info)\s*\(/.test(code)) {
          push({
            severity: 'info',
            ruleId: 'bug/console-log',
            title: 'Console logging in application code',
            file,
            line: i + 1,
            message:
              'Debug logging often leaks sensitive data and adds noise in production. Use a structured logger with levels, or remove before shipping.',
            snippet: line.trim(),
          });
        }

        if (/\.forEach\s*\(\s*async\b/.test(code)) {
          push({
            severity: 'warning',
            ruleId: 'bug/foreach-async',
            title: 'async callback in forEach',
            file,
            line: i + 1,
            message:
              'forEach does not await async callbacks — parallel work runs uncontrolled and errors are not propagated. Use for...of with await or Promise.all.',
            snippet: line.trim(),
          });
        }

        if (hasAssignmentInIfCondition(code)) {
          push({
            severity: 'warning',
            ruleId: 'bug/assignment-in-condition',
            title: 'Assignment inside if condition',
            file,
            line: i + 1,
            message:
              'Using = inside an if condition is usually a typo for == or ===. It assigns and always truth-checks the assigned value.',
            snippet: line.trim(),
          });
        }

        if (/\bthrow\s+['"`]/.test(code)) {
          push({
            severity: 'info',
            ruleId: 'bug/throw-literal',
            title: 'Throwing a string literal',
            file,
            line: i + 1,
            message:
              'Throwing strings loses stack traces. Throw new Error("message") so callers and monitors capture the stack.',
            snippet: line.trim(),
            autofix: {
              description: 'Wrap the message in new Error()',
              originalLine: line.trim(),
              fixedLine: line.replace(/throw\s+(['"`])([^'"`]+)\1/, 'throw new Error($1$2$1)').trim(),
              patchedFile: buildPatchedFile(
                lines,
                i,
                line.replace(/throw\s+(['"`])([^'"`]+)\1/, 'throw new Error($1$2$1)')
              ),
            },
          });
        }
      }
    }

    return findings;
  },
};
