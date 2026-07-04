import { generateAutofix, llmConfigured as aiReady } from './ai/llm.js';
import { resolveFindingFileContent } from './github/files.js';
import type { Autofix, Finding, ScanResult } from './types.js';

export async function resolveAutofix(
  scan: ScanResult,
  finding: Finding,
  token?: string
): Promise<Autofix> {
  if (finding.autofix?.patchedFile) return finding.autofix;

  if (!aiReady()) {
    throw new Error('No autofix available — configure ANTHROPIC_API_KEY or OPENAI_API_KEY for AI fixes');
  }

  const fileContent = await resolveFindingFileContent(scan, finding.file, token);

  return generateAutofix({
    title: finding.title,
    message: finding.message,
    ruleId: finding.ruleId,
    severity: finding.severity,
    file: finding.file,
    line: finding.line,
    snippet: finding.snippet,
    fileContent,
  });
}
