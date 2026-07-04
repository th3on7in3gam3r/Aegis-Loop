import { config, llmConfigured } from '../config.js';

export interface LlmAutofixResult {
  description: string;
  originalLine: string;
  fixedLine: string;
  patchedFile: string;
}

export { llmConfigured };

export async function generateAutofix(options: {
  title: string;
  message: string;
  ruleId: string;
  severity: string;
  file: string;
  line: number;
  snippet: string;
  fileContent: string;
}): Promise<LlmAutofixResult> {
  if (!llmConfigured()) {
    throw new Error('No LLM configured — set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env.local');
  }

  const provider = config.ai.provider;
  const system = `You are a senior application security engineer working on Aegis Loop.
Given a security finding and the full source file, produce a minimal safe fix.
Respond with valid JSON only — no markdown fences:
{"description":"brief fix explanation","originalLine":"the vulnerable line","fixedLine":"the corrected line","patchedFile":"complete fixed file contents"}`;

  const user = `Finding: ${options.title}
Rule: ${options.ruleId}
Severity: ${options.severity}
Message: ${options.message}
File: ${options.file}:${options.line}

Vulnerable line:
${options.snippet}

Full file (${options.file}):
${options.fileContent}`;

  const raw =
    provider === 'openai'
      ? await callOpenAi(system, user)
      : await callAnthropic(system, user);

  const parsed = JSON.parse(extractJson(raw)) as LlmAutofixResult;
  if (!parsed.patchedFile?.trim()) {
    throw new Error('LLM did not return a valid patch');
  }
  return parsed;
}

function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text.trim();
}

async function callAnthropic(system: string, user: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.ai.anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.ai.anthropicModel,
      max_tokens: 8192,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  const data = (await res.json()) as {
    content?: Array<{ text?: string }>;
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(data.error?.message ?? 'Anthropic API error');
  return data.content?.[0]?.text ?? '';
}

async function callOpenAi(system: string, user: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.ai.openaiKey}`,
    },
    body: JSON.stringify({
      model: config.ai.openaiModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(data.error?.message ?? 'OpenAI API error');
  return data.choices?.[0]?.message?.content ?? '';
}
