import { config, llmConfigured } from '../config.js';

export interface LlmAutofixResult {
  description: string;
  originalLine: string;
  fixedLine: string;
  patchedFile: string;
}

export { llmConfigured };

/** True when Anthropic rejected the request because the model id is invalid/retired. */
export function isAnthropicModelUnavailableError(
  status: number,
  detail: string
): boolean {
  const msg = detail.trim();
  if (/^model:/i.test(msg)) return true;
  if (status === 404 && /model/i.test(msg)) return true;
  if (/not_found_error/i.test(msg) && /model/i.test(msg)) return true;
  if (/model.*(not found|deprecated|retired|unavailable)/i.test(msg)) return true;
  return false;
}

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
  const kind = options.ruleId.startsWith('bug/')
    ? 'correctness bug'
    : 'security vulnerability';
  const system = `You are a senior software engineer working on Aegis Loop.
Given a ${kind} finding and the full source file, produce a minimal safe fix.
Respond with valid JSON only — no markdown fences:
{"description":"brief fix explanation","originalLine":"the problematic line","fixedLine":"the corrected line","patchedFile":"complete fixed file contents"}`;

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

async function callAnthropicOnce(
  system: string,
  user: string,
  model: string
): Promise<{ ok: true; text: string } | { ok: false; status: number; detail: string }> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.ai.anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  const data = (await res.json()) as {
    content?: Array<{ text?: string }>;
    error?: { message?: string; type?: string } | string;
  };

  if (!res.ok) {
    const detail =
      (typeof data.error === 'string' ? data.error : data.error?.message) ||
      `Anthropic API error (${res.status})`;
    return { ok: false, status: res.status, detail };
  }

  return { ok: true, text: data.content?.[0]?.text ?? '' };
}

async function callAnthropic(system: string, user: string): Promise<string> {
  const primary = config.ai.anthropicModel;
  const fallback = config.ai.anthropicModelFallback;

  const first = await callAnthropicOnce(system, user, primary);
  if (first.ok) return first.text;

  const canFallback =
    fallback &&
    fallback !== primary &&
    isAnthropicModelUnavailableError(first.status, first.detail);

  if (canFallback) {
    console.warn(
      `[ai] primary model unavailable (${primary}): ${first.detail} — retrying with fallback ${fallback}`
    );
    const second = await callAnthropicOnce(system, user, fallback);
    if (second.ok) return second.text;

    if (isAnthropicModelUnavailableError(second.status, second.detail)) {
      throw new Error(
        `AI models unavailable (tried ${primary}, then ${fallback}). Update ANTHROPIC_MODEL / ANTHROPIC_MODEL_FALLBACK on the server.`
      );
    }
    throw new Error(second.detail);
  }

  if (isAnthropicModelUnavailableError(first.status, first.detail)) {
    throw new Error(
      `AI model unavailable (${primary}). That model may be retired — set ANTHROPIC_MODEL=claude-sonnet-4-6 on the server (credits alone won’t help).`
    );
  }
  throw new Error(first.detail);
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
