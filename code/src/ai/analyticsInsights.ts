import { config, llmConfigured } from '../config.js';
import type { AnalyticsInsight, AnalyticsSummary } from '../analytics/types.js';

export { llmConfigured };

export async function generateAnalyticsInsights(
  summary: AnalyticsSummary,
): Promise<AnalyticsInsight[]> {
  if (!llmConfigured()) return [];

  const provider = config.ai.provider;
  const system = `You are a growth analyst for a developer security SaaS (Aegis Loop).
Given analytics JSON, return 2-4 concise insights as JSON array only:
[{"severity":"info|warning|opportunity","title":"short title","detail":"one sentence action"}]
Focus on visitors, channels, conversions, CTA clicks, scroll/heatmap patterns. No markdown.`;

  const user = JSON.stringify({
    siteGrade: summary.siteGrade,
    visitors: summary.visitors,
    pageviews: summary.pageviews,
    engagementChange: summary.engagementChange,
    channels: summary.channels.slice(0, 5),
    conversions: summary.conversions,
    topClicks: summary.topClicks.slice(0, 6),
    pages: summary.pages.slice(0, 5),
  });

  const raw =
    provider === 'openai'
      ? await callOpenAi(system, user)
      : await callAnthropic(system, user);

  const parsed = JSON.parse(extractJson(raw)) as AnalyticsInsight[];
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item) => item?.title && item?.detail)
    .map((item, i) => ({
      id: `ai-${i + 1}`,
      severity: item.severity === 'warning' || item.severity === 'opportunity' ? item.severity : 'info',
      title: String(item.title).slice(0, 120),
      detail: String(item.detail).slice(0, 280),
    }));
}

function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
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
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const data = (await res.json()) as { content?: Array<{ text?: string }> };
  return data.content?.[0]?.text ?? '[]';
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
      max_tokens: 1024,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? '[]';
}
