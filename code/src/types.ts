export type Severity = 'critical' | 'warning' | 'info';

export type AegisModule = 'code' | 'cloud' | 'attack' | 'protect';

export interface Autofix {
  description: string;
  originalLine: string;
  fixedLine: string;
  patchedFile: string;
}

export interface FindingRemediation {
  summary: string;
  steps: string[];
}

export interface Finding {
  id: string;
  scanId: string;
  severity: Severity;
  ruleId: string;
  title: string;
  file: string;
  line: number;
  message: string;
  snippet: string;
  autofix?: Autofix;
  remediation?: FindingRemediation;
  fixed: boolean;
  prUrl?: string;
}

export interface ScanStats {
  critical: number;
  warning: number;
  info: number;
  resolved: number;
  score: number;
}

export interface PullRequestMeta {
  number: number;
  url: string;
  title: string;
  headBranch: string;
  baseBranch: string;
  headSha: string;
}

export interface ScanResult {
  id: string;
  module?: AegisModule;
  userLogin?: string;
  repo: string;
  branch: string;
  target?: string;
  status: 'running' | 'complete' | 'failed';
  error?: string;
  startedAt: string;
  completedAt?: string;
  findings: Finding[];
  stats: ScanStats;
  pullRequest?: PullRequestMeta;
  githubCommentUrl?: string;
  checkStatusUrl?: string;
}

export interface GitHubSession {
  token: string;
  login: string;
  name: string | null;
  avatarUrl: string;
}

export interface ScanRule {
  id: string;
  title: string;
  run: (ctx: RuleContext) => FindingDraft[];
}

export interface RuleContext {
  scanId: string;
  rootDir: string;
  readFile: (relativePath: string) => string | null;
  listFiles: () => string[];
}

export type FindingDraft = Omit<Finding, 'id' | 'scanId' | 'fixed' | 'prUrl'>;

export interface ProtectRule {
  id: string;
  source: AegisModule | 'builtin';
  title: string;
  pattern: string;
  description: string;
  enabled: boolean;
  blocked: number;
  findingRuleId?: string;
}

export interface ProtectEvent {
  id: string;
  ruleId: string;
  path: string;
  method: string;
  blockedAt: string;
  detail: string;
}
