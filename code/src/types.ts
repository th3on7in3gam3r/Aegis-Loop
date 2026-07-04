export type Severity = 'critical' | 'warning' | 'info';

export interface Autofix {
  description: string;
  originalLine: string;
  fixedLine: string;
  patchedFile: string;
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
  repo: string;
  branch: string;
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
