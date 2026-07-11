import crypto from 'node:crypto';

export type StudioOpsEventType =
  | 'user.signup'
  | 'subscription.upgraded'
  | 'subscription.canceled'
  | 'bundle.activated'
  | 'bundle.updated'
  | 'bundle.canceled';

/** Prefer STUDIO_OPS_URL (base). Falls back to full STUDIO_OPS_WEBHOOK_URL. */
function resolveStudioOpsEndpoint(): string | null {
  const base = process.env.STUDIO_OPS_URL?.trim();
  if (base) {
    return `${base.replace(/\/+$/, '')}/api/events`;
  }
  const legacy = process.env.STUDIO_OPS_WEBHOOK_URL?.trim();
  return legacy || null;
}

function webhookSecret(): string | null {
  return process.env.STUDIO_OPS_WEBHOOK_SECRET?.trim() || null;
}

export function studioOpsConfigured(): boolean {
  return Boolean(resolveStudioOpsEndpoint() && webhookSecret());
}

export function signStudioOpsBody(body: string, secret = webhookSecret()): string | null {
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/** Fire-and-forget — Studio Ops ingest schema (matches Cadence / CitePilot). */
export function emitStudioOpsEvent(input: {
  event: StudioOpsEventType;
  email?: string | null;
  externalUserId: string;
  metadata?: Record<string, unknown>;
}): void {
  const url = resolveStudioOpsEndpoint();
  const secret = webhookSecret();
  if (!url || !secret) return;

  const body = JSON.stringify({
    product: 'aegis',
    event: input.event,
    email: input.email ?? null,
    externalUserId: input.externalUserId,
    metadata: input.metadata ?? {},
  });

  const signature = signStudioOpsBody(body, secret);
  if (!signature) return;

  void fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Studio-Ops-Signature': signature,
    },
    body,
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {
    /* fire-and-forget — Studio Ops must tolerate missed events */
  });
}

export function emitUserSignup(input: {
  githubLogin: string;
  authMethod: 'oauth' | 'pat';
  email?: string | null;
}): void {
  emitStudioOpsEvent({
    event: 'user.signup',
    email: input.email ?? null,
    externalUserId: input.githubLogin,
    metadata: {
      githubLogin: input.githubLogin,
      authMethod: input.authMethod,
    },
  });
}

export function emitSubscriptionUpgraded(input: {
  githubLogin: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  email?: string | null;
}): void {
  emitStudioOpsEvent({
    event: 'subscription.upgraded',
    email: input.email ?? null,
    externalUserId: input.githubLogin,
    metadata: {
      githubLogin: input.githubLogin,
      plan: 'team',
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
    },
  });
}

export function emitSubscriptionCanceled(input: {
  githubLogin: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  email?: string | null;
}): void {
  emitStudioOpsEvent({
    event: 'subscription.canceled',
    email: input.email ?? null,
    externalUserId: input.githubLogin,
    metadata: {
      githubLogin: input.githubLogin,
      plan: 'free',
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
    },
  });
}

export function emitBundleStudioOpsEvent(input: {
  type: 'bundle.activated' | 'bundle.updated' | 'bundle.canceled';
  githubLogin: string;
  bundleId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  products: string[];
  email?: string | null;
}): void {
  emitStudioOpsEvent({
    event: input.type,
    email: input.email ?? null,
    externalUserId: input.githubLogin,
    metadata: {
      githubLogin: input.githubLogin,
      bundleId: input.bundleId,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      products: input.products,
    },
  });
}
