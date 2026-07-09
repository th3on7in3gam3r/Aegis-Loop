import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import type { PlanId } from './plans.js';

export interface ApiKeyRecord {
  id: string;
  label: string;
  prefix: string;
  hash: string;
  createdAt: string;
}

export interface Account {
  login: string;
  plan: PlanId;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  seats?: number;
  apiKeys: ApiKeyRecord[];
  createdAt: string;
  updatedAt: string;
}

const STORE_FILE = join(config.dataDir, 'accounts.json');
const accounts = new Map<string, Account>();

function persist(): void {
  try {
    mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(STORE_FILE, JSON.stringify([...accounts.values()], null, 2));
  } catch {
    /* disk issue — keep in-memory */
  }
}

export function loadAccountStore(): void {
  if (!existsSync(STORE_FILE)) return;
  try {
    const data = JSON.parse(readFileSync(STORE_FILE, 'utf8')) as Account[];
    for (const account of data) accounts.set(account.login, account);
  } catch {
    /* corrupt — start fresh */
  }
}

export function accountExists(login: string): boolean {
  return accounts.has(login);
}

export function getAccount(login: string): Account {
  let account = accounts.get(login);
  if (!account) {
    const now = new Date().toISOString();
    account = {
      login,
      plan: 'free',
      apiKeys: [],
      createdAt: now,
      updatedAt: now,
    };
    accounts.set(login, account);
    persist();
  }
  return account;
}

export function saveAccount(account: Account): Account {
  account.updatedAt = new Date().toISOString();
  accounts.set(account.login, account);
  persist();
  return account;
}

export function setAccountPlan(
  login: string,
  plan: PlanId,
  patch: Partial<Pick<Account, 'stripeCustomerId' | 'stripeSubscriptionId' | 'seats'>> = {}
): Account {
  const account = getAccount(login);
  account.plan = plan;
  if (patch.stripeCustomerId !== undefined) account.stripeCustomerId = patch.stripeCustomerId;
  if (patch.stripeSubscriptionId !== undefined) account.stripeSubscriptionId = patch.stripeSubscriptionId;
  if (patch.seats !== undefined) account.seats = patch.seats;
  return saveAccount(account);
}

function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function createApiKey(login: string, label = 'Default'): { key: string; record: ApiKeyRecord } {
  const account = getAccount(login);
  const raw = `aegis_${randomBytes(24).toString('base64url')}`;
  const record: ApiKeyRecord = {
    id: randomUUID(),
    label,
    prefix: raw.slice(0, 12),
    hash: hashApiKey(raw),
    createdAt: new Date().toISOString(),
  };
  account.apiKeys.push(record);
  saveAccount(account);
  return { key: raw, record };
}

export function revokeApiKey(login: string, keyId: string): boolean {
  const account = getAccount(login);
  const before = account.apiKeys.length;
  account.apiKeys = account.apiKeys.filter((k) => k.id !== keyId);
  if (account.apiKeys.length === before) return false;
  saveAccount(account);
  return true;
}

export function findAccountByApiKey(raw: string): Account | null {
  if (!raw.startsWith('aegis_')) return null;
  const hash = hashApiKey(raw);
  for (const account of accounts.values()) {
    if (account.apiKeys.some((k) => k.hash === hash)) return account;
  }
  return null;
}

export function findAccountByStripeCustomer(customerId: string): Account | undefined {
  return [...accounts.values()].find((a) => a.stripeCustomerId === customerId);
}

export function findAccountByStripeSubscription(subscriptionId: string): Account | undefined {
  return [...accounts.values()].find((a) => a.stripeSubscriptionId === subscriptionId);
}
