import type { FindingDraft, RuleContext } from '../../types.js';
import { parsePackageVersion, queryOsvBatch } from '../osv.js';

function bumpRange(currentRange: string, fixedVersion: string): string {
  const prefix = currentRange.match(/^[\^~]/)?.[0] ?? '^';
  return `${prefix}${fixedVersion}`;
}

function applyPackageBump(
  pkg: Record<string, unknown>,
  name: string,
  newRange: string,
  field: 'dependencies' | 'devDependencies'
): Record<string, unknown> {
  return {
    ...pkg,
    [field]: { ...(pkg[field] as Record<string, string>), [name]: newRange },
  };
}

export async function runOsvDependencyScan(ctx: RuleContext): Promise<FindingDraft[]> {
  const findings: FindingDraft[] = [];
  const pkgContent = ctx.readFile('package.json');
  if (!pkgContent) return findings;

  let pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  try {
    pkg = JSON.parse(pkgContent);
  } catch {
    return findings;
  }

  const entries: Array<{ name: string; version: string; range: string; field: 'dependencies' | 'devDependencies' }> = [];

  for (const [name, range] of Object.entries(pkg.dependencies ?? {})) {
    entries.push({ name, version: parsePackageVersion(range), range, field: 'dependencies' });
  }
  for (const [name, range] of Object.entries(pkg.devDependencies ?? {})) {
    entries.push({ name, version: parsePackageVersion(range), range, field: 'devDependencies' });
  }

  const osvResults = await queryOsvBatch(entries.map((e) => ({ name: e.name, version: e.version })));
  let workingPkg: Record<string, unknown> = { ...pkg };

  for (const entry of entries) {
    const vulns = osvResults.get(`${entry.name}@${entry.version}`);
    if (!vulns?.length) continue;

    const top = vulns[0];
    const cveList = vulns.slice(0, 3).map((v) => v.id).join(', ');
    const newRange = top.fixedVersion ? bumpRange(entry.range, top.fixedVersion) : entry.range;

    if (top.fixedVersion) {
      workingPkg = applyPackageBump(workingPkg, entry.name, newRange, entry.field);
    }

    findings.push({
      severity: top.severity,
      ruleId: 'osv-dependency',
      title: `Vulnerable dependency: ${entry.name}@${entry.version}`,
      file: 'package.json',
      line: 1,
      message: `${cveList} — ${top.summary}`,
      snippet: `"${entry.name}": "${entry.range}"`,
      autofix: top.fixedVersion
        ? {
            description: `Upgrade ${entry.name} to ${newRange} (fixes ${top.id})`,
            originalLine: `"${entry.name}": "${entry.range}"`,
            fixedLine: `"${entry.name}": "${newRange}"`,
            patchedFile: JSON.stringify(workingPkg, null, 2) + '\n',
          }
        : undefined,
    });
  }

  return findings;
}
