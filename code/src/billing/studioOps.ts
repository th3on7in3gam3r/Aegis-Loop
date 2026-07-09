import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';

export type StudioOpsEventType =
  | 'user.signup'
  | 'subscription.upgraded'
  | 'subscription.canceled'
  | 'bundle.activated'
  | 'bundle.updated'
  | 'bundle.canceled';

export interface StudioOpsEventBase {
  id: string;
  type: StudioOpsEventType;
  product: 'aegis';
  githubLogin: string;
  email: string | null;
  occurredAt: string;
}

export interface StudioOpsUserSignupEvent extends StudioOpsEventBase {
  type: 'user.signup';
  authMethod: 'oauth' | 'pat';
}

export interface StudioOpsSubscriptionEvent extends StudioOpsEventBase {
  type: 'subscription.upgraded' | 'subscription.canceled';
  plan: 'team' | 'free';
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
}

export interface StudioOpsBundleEvent extends StudioOpsEventBase {
  type: 'bundle.activated' | 'bundle.updated' | 'bundle.canceled';
  bundleId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  products: string[];
}

export type StudioOpsEvent =
  | StudioOpsUserSignupEvent
  | StudioOpsSubscriptionEvent
  | StudioOpsBundleEvent;

function webhookUrl(): string | null {
  return process.env.STUDIO_OPS_WEBHOOK_URL?.trim() || null;
}

function webhookSecret(): string | null {
  return process.env.STUDIO_OPS_WEBHOOK_SECRET?.trim() || null;
}

export function studioOpsConfigured(): boolean {
  return Boolean(webhookUrl() && webhookSecret());
}

export function signStudioOpsBody(body: string, secret = webhookSecret()): string | null {
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

export function emitStudioOpsEvent(
  event: Omit<StudioOpsEvent, 'id' | 'product' | 'occurredAt'> & {
    id?: string;
    product?: 'aegis';
    occurredAt?: string;
  },
): void {
  const url = webhookUrl();
  const secret = webhookSecret();
  if (!url || !secret) return;

  const payload: StudioOpsEvent = {
    id: event.id ?? randomUUID(),
    product: event.product ?? 'aegis',
    occurredAt: event.occurredAt ?? new Date().toISOString(),
    ...event,
  } as StudioOpsEvent;

  const body = JSON.stringify(payload);
  const signature = signStudioOpsBody(body, secret);
  if (!signature) return;

  void fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Studio-Ops-Signature': signature,
    },
    body,
  }).catch(() => {
    /* fire-and-forget — Studio Ops must tolerate retries */
  });
}

export function emitUserSignup(input: {
  githubLogin: string;
  authMethod: 'oauth' | 'pat';
  email?: string | null;
}): void {
  emitStudioOpsEvent({
    type: 'user.signup',
    githubLogin: input.githubLogin,
    email: input.email ?? null,
    authMethod: input.authMethod,
  });
}

export function emitSubscriptionUpgraded(input: {
  githubLogin: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  email?: string | null;
}): void {
  emitStudioOpsEvent({
    type: 'subscription.upgraded',
    githubLogin: input.githubLogin,
    email: input.email ?? null,
    plan: 'team',
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
  });
}

export function emitSubscriptionCanceled(input: {
  githubLogin: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  email?: string | null;
}): void {
  emitStudioOpsEvent({
    type: 'subscription.canceled',
    githubLogin: input.githubLogin,
    email: input.email ?? null,
    plan: 'free',
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
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
    type: input.type,
    githubLogin: input.githubLogin,
    email: input.email ?? null,
    bundleId: input.bundleId,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    products: input.products,
  });
}
