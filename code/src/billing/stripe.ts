import Stripe from 'stripe';
import { config, stripeConfigured } from '../config.js';
import {
  emitSubscriptionCanceled,
  emitSubscriptionUpgraded,
} from './studioOps.js';
import {
  findAccountByStripeCustomer,
  findAccountByStripeSubscription,
  getAccount,
  saveAccount,
  setAccountPlan,
  type Account,
} from './store.js';
import { isOwnerLogin } from './owners.js';

let stripe: Stripe | null = null;

function client(): Stripe | null {
  if (!stripeConfigured()) return null;
  if (!stripe) stripe = new Stripe(config.stripe.secretKey);
  return stripe;
}

export { stripeConfigured };

export async function createCheckoutSession(login: string, seats = 1): Promise<string | null> {
  const s = client();
  if (!s || !config.stripe.teamPriceId) return null;

  const account = getAccount(login);
  let customerId = account.stripeCustomerId;

  if (!customerId) {
    const customer = await s.customers.create({
      metadata: { githubLogin: login },
    });
    customerId = customer.id;
    account.stripeCustomerId = customerId;
    saveAccount(account);
  }

  const session = await s.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: config.stripe.teamPriceId, quantity: Math.max(1, seats) }],
    success_url: `${config.appUrl}/app/?billing=success`,
    cancel_url: `${config.appUrl}/app/?billing=cancel`,
    metadata: { githubLogin: login },
    subscription_data: { metadata: { githubLogin: login } },
  });

  return session.url;
}

export async function createBillingPortalSession(login: string): Promise<string | null> {
  const s = client();
  if (!s) return null;
  const account = getAccount(login);
  if (!account.stripeCustomerId) return null;
  const session = await s.billingPortal.sessions.create({
    customer: account.stripeCustomerId,
    return_url: `${config.appUrl}/app/?view=settings`,
  });
  return session.url;
}

/** Pull active subscription from Stripe and apply Team plan (fallback when webhooks lag or fail). */
export async function syncBillingFromStripe(login: string): Promise<Account> {
  const s = client();
  const account = getAccount(login);
  if (!s) return account;

  let customerId = account.stripeCustomerId;
  if (!customerId) {
    const found = await s.customers.search({ query: `metadata['githubLogin']:'${login}'` });
    customerId = found.data[0]?.id;
    if (customerId) {
      account.stripeCustomerId = customerId;
      saveAccount(account);
    }
  }
  if (!customerId) return account;

  const subs = await s.subscriptions.list({ customer: customerId, status: 'all', limit: 10 });
  const active = subs.data.find((sub) => sub.status === 'active' || sub.status === 'trialing');
  if (active) {
    applyPlanChange(login, 'team', {
      stripeCustomerId: customerId,
      stripeSubscriptionId: active.id,
      seats: active.items.data[0]?.quantity ?? 1,
    });
  }
  return getAccount(login);
}

function applyPlanChange(
  login: string,
  plan: 'team' | 'free',
  patch: Partial<Pick<Account, 'stripeCustomerId' | 'stripeSubscriptionId' | 'seats'>> = {},
): void {
  if (plan === 'free' && isOwnerLogin(login)) return;

  const account = getAccount(login);
  const prevPlan = account.plan;
  setAccountPlan(login, plan, patch);

  if (prevPlan !== 'team' && plan === 'team') {
    emitSubscriptionUpgraded({
      githubLogin: login,
      stripeCustomerId: patch.stripeCustomerId ?? account.stripeCustomerId,
      stripeSubscriptionId: patch.stripeSubscriptionId ?? account.stripeSubscriptionId,
    });
  } else if (prevPlan === 'team' && plan === 'free') {
    emitSubscriptionCanceled({
      githubLogin: login,
      stripeCustomerId: patch.stripeCustomerId ?? account.stripeCustomerId,
      stripeSubscriptionId: patch.stripeSubscriptionId ?? account.stripeSubscriptionId,
    });
  }
}

export async function handleStripeWebhook(rawBody: string, signature: string): Promise<void> {
  const s = client();
  if (!s || !config.stripe.webhookSecret) throw new Error('Stripe webhook not configured');

  const event = s.webhooks.constructEvent(rawBody, signature, config.stripe.webhookSecret);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const login = session.metadata?.githubLogin;
      const subscriptionId =
        typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
      if (login && subscriptionId) {
        applyPlanChange(login, 'team', {
          stripeCustomerId: session.customer as string,
          stripeSubscriptionId: subscriptionId,
          seats: 1,
        });
      }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      const login = sub.metadata?.githubLogin;
      const account =
        (login ? getAccount(login) : undefined) ??
        findAccountByStripeSubscription(sub.id) ??
        findAccountByStripeCustomer(sub.customer as string);
      if (!account) break;
      if (sub.status === 'active' || sub.status === 'trialing') {
        applyPlanChange(account.login, 'team', {
          stripeCustomerId: sub.customer as string,
          stripeSubscriptionId: sub.id,
          seats: sub.items.data[0]?.quantity ?? 1,
        });
      } else if (sub.status === 'canceled' || sub.status === 'unpaid') {
        applyPlanChange(account.login, 'free', { stripeSubscriptionId: undefined, seats: 1 });
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const account =
        findAccountByStripeSubscription(sub.id) ??
        findAccountByStripeCustomer(sub.customer as string);
      if (account) {
        applyPlanChange(account.login, 'free', { stripeSubscriptionId: undefined, seats: 1 });
      }
      break;
    }
    default:
      break;
  }
}
