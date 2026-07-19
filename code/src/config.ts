import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT) || 3847,
  appUrl: process.env.APP_URL || 'http://localhost:3847',
  demoRepo: join(__dirname, '../fixtures/sample-repo'),
  cloudDemoRepo: join(__dirname, '../fixtures/cloud-demo'),
  dataDir: process.env.AEGIS_DATA_DIR || join(__dirname, '../data'),
  contactEmail: process.env.CONTACT_EMAIL || 'hello@aegisloop.dev',
  sessionSecret: process.env.SESSION_SECRET || 'aegis-loop-dev-secret-change-in-prod',
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    teamPriceId: process.env.STRIPE_TEAM_PRICE_ID || '',
  },
  github: {
    clientId: process.env.GITHUB_CLIENT_ID || '',
    clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || '',
    token: process.env.GITHUB_TOKEN || '',
  },
  ai: {
    provider:
      process.env.LLM_PROVIDER === 'openai'
        ? 'openai'
        : process.env.LLM_PROVIDER === 'anthropic'
          ? 'anthropic'
          : process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY
            ? 'openai'
            : 'anthropic',
    anthropicKey: process.env.ANTHROPIC_API_KEY || '',
    openaiKey: process.env.OPENAI_API_KEY || '',
    anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    openaiModel: process.env.OPENAI_MODEL || 'gpt-4o',
  },
} as const;

export function oauthConfigured(): boolean {
  return Boolean(config.github.clientId && config.github.clientSecret);
}

export function llmConfigured(): boolean {
  if (config.ai.provider === 'openai') return Boolean(config.ai.openaiKey);
  return Boolean(config.ai.anthropicKey);
}

export function stripeConfigured(): boolean {
  return Boolean(config.stripe.secretKey && config.stripe.teamPriceId);
}
