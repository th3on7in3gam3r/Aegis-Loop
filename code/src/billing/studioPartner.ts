import crypto from 'node:crypto';
import { getAccount, setAccountPlan, type Account } from './store.js';
import { emitBundleStudioOpsEvent } from './studioOps.js';

export type StudioBillingEventType =
  | 'bundle.activated'
  | 'bundle.updated'
  | 'bundle.canceled';

export interface StudioBillingPartnerEvent {
  id: string;
  type: StudioBillingEventType;
  bundleId: string;
  supabaseUserId: string;
  email: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  products: string[];
  entitlements: Record<string, unknown>;
  linkedIds: {
    clerkId?: string | null;
    citepilotUserId?: string | null;
    kerygmaUserId?: string | null;
    aegisGithubLogin?: string | null;
  };
  occurredAt: string;
}

function fanoutSecret(): string | null {
  return process.env.STUDIO_BILLING_FANOUT_SECRET?.trim() || null;
}

export function verifyStudioBillingSignature(body: string, signature: string | undefined): boolean {
  const secret = fanoutSecret();
  if (!secret || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signature, 'utf8'));
  } catch {
    return false;
  }
}

export function handleStudioBillingPartnerEvent(
  event: StudioBillingPartnerEvent,
): { ok: boolean; login?: string; plan?: string; error?: string } {
  if (!event.products.includes('aegis')) {
    return { ok: true, error: 'skipped' };
  }

  const login = event.linkedIds.aegisGithubLogin?.trim();
  if (!login) {
    return { ok: false, error: 'No GitHub login — link Aegis in AI CMO Studio settings' };
  }

  getAccount(login);

  if (event.type === 'bundle.canceled') {
    setAccountPlan(login, 'free', { stripeSubscriptionId: undefined, seats: 1 });
    emitBundleStudioOpsEvent({
      type: event.type,
      githubLogin: login,
      bundleId: event.bundleId,
      stripeCustomerId: event.stripeCustomerId,
      stripeSubscriptionId: event.stripeSubscriptionId,
      products: event.products,
      email: event.email || null,
    });
    return { ok: true, login, plan: 'free' };
  }

  const ent = event.entitlements.aegis as { plan?: string } | undefined;
  if (ent?.plan === 'team') {
    setAccountPlan(login, 'team', {
      stripeCustomerId: event.stripeCustomerId,
      stripeSubscriptionId: event.stripeSubscriptionId,
      seats: 3,
    });
    emitBundleStudioOpsEvent({
      type: event.type,
      githubLogin: login,
      bundleId: event.bundleId,
      stripeCustomerId: event.stripeCustomerId,
      stripeSubscriptionId: event.stripeSubscriptionId,
      products: event.products,
      email: event.email || null,
    });
    return { ok: true, login, plan: 'team' };
  }

  return { ok: false, error: 'No aegis entitlement in bundle' };
}
