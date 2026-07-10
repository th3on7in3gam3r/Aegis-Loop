import { resolve } from 'node:path';
import { scanDirectory } from './scanner/index.js';

const target = process.argv[2] ?? '.';
const abs = resolve(process.cwd(), target);
const label = abs.includes('sample-repo') ? 'aegis-loop/sample-app' : 'cli/local';

const scan = await scanDirectory(abs, label, 'main');

console.log(`\nScan complete — ${scan.findings.length} findings (score ${scan.stats.score})\n`);

for (const f of scan.findings) {
  const fix = f.autofix ? ' [autofix]' : '';
  console.log(`  [${f.severity.padEnd(8)}] ${f.title} — ${f.file}:${f.line}${fix}`);
}

if (scan.findings.length === 0) {
  console.log('  No findings — nice work.\n');
} else {
  console.log(`\nOpen ${process.env.AEGIS_API_URL ?? 'https://aegis-loop.com'}/app for A-Fix and PR integration.\n`);
}

process.exit(scan.stats.critical > 0 ? 1 : 0);
