import type { PlanId } from './plans.js';
import { getAccount, setAccountPlan, type Account } from './store.js';

function ownerLogins(): Set<string> {
  const raw = process.env.AEGIS_OWNER_LOGINS?.trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function ownerPlanForLogin(login: string): PlanId | null {
  if (!ownerLogins().has(login.toLowerCase())) return null;
  const configured = process.env.AEGIS_OWNER_PLAN?.trim().toLowerCase();
  if (configured === 'team' || configured === 'enterprise') return configured;
  return 'enterprise';
}

export function isOwnerLogin(login: string): boolean {
  return ownerPlanForLogin(login) !== null;
}

/** Apply comped Team/Enterprise from server env — never exposed to the client. */
export function syncOwnerPlan(login: string): Account {
  const ownerPlan = ownerPlanForLogin(login);
  const account = getAccount(login);
  if (!ownerPlan || account.plan === ownerPlan) return account;
  return setAccountPlan(login, ownerPlan, {
    seats: ownerPlan === 'enterprise' ? 10 : 3,
  });
}

export function getAccountForUser(login: string): Account {
  return syncOwnerPlan(login);
}
