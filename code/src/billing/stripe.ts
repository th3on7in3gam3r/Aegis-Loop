import Stripe from 'stripe';
import { config, stripeConfigured } from '../config.js';
import {
  findAccountByStripeCustomer,
  findAccountByStripeSubscription,
  getAccount,
  saveAccount,
  setAccountPlan,
} from './store.js';

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

export async function handleStripeWebhook(rawBody: string, signature: string): Promise<void> {
  const s = client();
  if (!s || !config.stripe.webhookSecret) throw new Error('Stripe webhook not configured');

  const event = s.webhooks.constructEvent(rawBody, signature, config.stripe.webhookSecret);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const login = session.metadata?.githubLogin;
      if (login && session.subscription) {
        setAccountPlan(login, 'team', {
          stripeCustomerId: session.customer as string,
          stripeSubscriptionId: session.subscription as string,
          seats: session.amount_total ? undefined : 1,
        });
      }
      break;
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      const login = sub.metadata?.githubLogin;
      const account =
        (login ? getAccount(login) : undefined) ??
        findAccountByStripeSubscription(sub.id) ??
        findAccountByStripeCustomer(sub.customer as string);
      if (!account) break;
      if (sub.status === 'active' || sub.status === 'trialing') {
        setAccountPlan(account.login, 'team', {
          stripeCustomerId: sub.customer as string,
          stripeSubscriptionId: sub.id,
          seats: sub.items.data[0]?.quantity ?? 1,
        });
      } else if (sub.status === 'canceled' || sub.status === 'unpaid') {
        setAccountPlan(account.login, 'free', { stripeSubscriptionId: undefined, seats: 1 });
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const account =
        findAccountByStripeSubscription(sub.id) ??
        findAccountByStripeCustomer(sub.customer as string);
      if (account) {
        setAccountPlan(account.login, 'free', { stripeSubscriptionId: undefined, seats: 1 });
      }
      break;
    }
    default:
      break;
  }
}
