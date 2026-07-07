export type PlanId = 'free' | 'team' | 'enterprise';

export type AegisModule = 'code' | 'cloud' | 'attack' | 'protect';

export interface PlanLimits {
  id: PlanId;
  label: string;
  maxRepos: number;
  autofix: boolean;
  modules: AegisModule[];
  pricePerSeatMonthly?: number;
}

export const PLANS: Record<PlanId, PlanLimits> = {
  free: {
    id: 'free',
    label: 'Free',
    maxRepos: 3,
    autofix: false,
    modules: ['code'],
  },
  team: {
    id: 'team',
    label: 'Team',
    maxRepos: Infinity,
    autofix: true,
    modules: ['code', 'cloud', 'attack', 'protect'],
    pricePerSeatMonthly: 29,
  },
  enterprise: {
    id: 'enterprise',
    label: 'Enterprise',
    maxRepos: Infinity,
    autofix: true,
    modules: ['code', 'cloud', 'attack', 'protect'],
  },
};

const DEMO_REPOS = new Set(['aegis-loop/sample-app', 'aegis-loop/cloud-demo']);

export function isDemoRepo(repo: string): boolean {
  return DEMO_REPOS.has(repo) || repo.startsWith('aegis-loop/');
}

export function planAllowsModule(plan: PlanId, module: AegisModule): boolean {
  return PLANS[plan].modules.includes(module);
}

export function planAllowsAutofix(plan: PlanId): boolean {
  return PLANS[plan].autofix;
}

export function planRepoLimit(plan: PlanId): number {
  return PLANS[plan].maxRepos;
}
