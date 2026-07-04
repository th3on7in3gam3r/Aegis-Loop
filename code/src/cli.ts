import { resolve } from 'node:path';
import { config } from './config.js';
import './load-env.js';
import { scanDirectory } from './scanner/index.js';

const target = process.argv[2] ?? 'fixtures/sample-repo';
const abs = resolve(process.cwd(), target);
const label = target.includes('sample-repo') ? 'aegis-loop/sample-app' : 'cli/local';

const scan = await scanDirectory(abs, label, 'main');

console.log(`\nScan complete — ${scan.findings.length} findings (score ${scan.stats.score})\n`);

for (const f of scan.findings) {
  const fix = f.autofix ? ' [autofix]' : '';
  console.log(`  [${f.severity.padEnd(8)}] ${f.title} — ${f.file}:${f.line}${fix}`);
}

console.log(`\nDemo repo path: ${config.demoRepo}\n`);
