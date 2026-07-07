import { listScans } from '../store.js';
import type { Account } from './store.js';
import { isDemoRepo, planAllowsAutofix, planAllowsModule, planRepoLimit, type PlanId } from './plans.js';
import type { AegisModule } from '../types.js';

export function distinctReposForUser(login: string): Set<string> {
  const repos = new Set<string>();
  for (const scan of listScans('code')) {
    if (scan.userLogin && scan.userLogin !== login) continue;
    if (scan.status !== 'complete') continue;
    if (isDemoRepo(scan.repo)) continue;
    repos.add(scan.repo);
  }
  return repos;
}

export function canScanRepo(account: Account, repo: string): { ok: true } | { ok: false; reason: string } {
  if (isDemoRepo(repo)) return { ok: true };
  const limit = planRepoLimit(account.plan);
  if (!Number.isFinite(limit)) return { ok: true };
  const repos = distinctReposForUser(account.login);
  if (repos.has(repo)) return { ok: true };
  if (repos.size >= limit) {
    return {
      ok: false,
      reason: `Free plan supports up to ${limit} repositories. Upgrade to Team for unlimited repos.`,
    };
  }
  return { ok: true };
}

export function assertModuleAccess(plan: PlanId, module: AegisModule): string | null {
  if (planAllowsModule(plan, module)) return null;
  const label = module.charAt(0).toUpperCase() + module.slice(1);
  return `${label} module requires a Team plan. Upgrade at /#pricing.`;
}

export function assertAutofixAccess(plan: PlanId): string | null {
  if (planAllowsAutofix(plan)) return null;
  return 'A-Fix requires a Team plan. Upgrade at /#pricing.';
}

export function planSummary(account: Account) {
  const repos = distinctReposForUser(account.login);
  const limit = planRepoLimit(account.plan);
  return {
    plan: account.plan,
    label: account.plan === 'team' ? 'Team' : account.plan === 'enterprise' ? 'Enterprise' : 'Free',
    reposUsed: repos.size,
    reposLimit: Number.isFinite(limit) ? limit : null,
    autofix: planAllowsAutofix(account.plan),
    modules: account.plan === 'free' ? ['code'] : ['code', 'cloud', 'attack', 'protect'],
    seats: account.seats ?? 1,
    stripeConfigured: Boolean(account.stripeSubscriptionId),
  };
}
