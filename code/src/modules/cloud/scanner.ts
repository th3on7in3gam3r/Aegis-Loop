import { randomUUID } from 'node:crypto';
import type { Finding, FindingDraft, ScanResult } from '../../types.js';
import { lineNumberAt, readRepoFile, snippetAround, walkFiles } from '../files.js';
import { attachRemediation } from '../remediation.js';
import { calcStats } from '../stats.js';

const IAC_PATTERN = /\.(tf|tfvars|yaml|yml|json|hcl)$/i;
const IAC_NAME = /docker-compose|cloudformation|Dockerfile|serverless/i;

interface CloudPatternRule {
  id: string;
  title: string;
  severity: Finding['severity'];
  regex: RegExp;
  message: string;
  provider: string;
}

const RULES: CloudPatternRule[] = [
  {
    id: 'cloud/s3-public-acl',
    title: 'Public S3 bucket ACL',
    severity: 'critical',
    regex: /acl\s*=\s*["']public-read|block_public_acls\s*=\s*false|BlockPublicAcls:\s*false/i,
    message: 'S3 bucket or ACL allows public read access — data may be exposed to the internet.',
    provider: 'AWS',
  },
  {
    id: 'cloud/sg-open-world',
    title: 'Security group open to the world',
    severity: 'critical',
    regex: /0\.0\.0\.0\/0|::\/0/,
    message: 'Ingress rule allows traffic from any IP (0.0.0.0/0) — restrict to known CIDR ranges.',
    provider: 'AWS',
  },
  {
    id: 'cloud/iam-wildcard',
    title: 'Overly permissive IAM policy',
    severity: 'warning',
    regex: /"Action"\s*:\s*"\*"|Action\s*=\s*"\*"/,
    message: 'IAM policy grants wildcard Action — use least-privilege permissions.',
    provider: 'AWS',
  },
  {
    id: 'cloud/k8s-public-lb',
    title: 'Public Kubernetes load balancer',
    severity: 'warning',
    regex: /type:\s*LoadBalancer|Type:\s*LoadBalancer/,
    message: 'Service exposes a public LoadBalancer — confirm intent and restrict with network policies.',
    provider: 'Kubernetes',
  },
  {
    id: 'cloud/docker-exposed-port',
    title: 'Container port bound to all interfaces',
    severity: 'warning',
    regex: /0\.0\.0\.0:\d+|"\d+:\d+"/,
    message: 'Docker port published on 0.0.0.0 — bind to 127.0.0.1 unless public access is required.',
    provider: 'Docker',
  },
  {
    id: 'cloud/gcp-public-bucket',
    title: 'GCP bucket public access',
    severity: 'critical',
    regex: /allUsers|allAuthenticatedUsers|uniform_bucket_level_access\s*=\s*false/i,
    message: 'GCS bucket may allow public access — enforce uniform bucket-level access.',
    provider: 'GCP',
  },
  {
    id: 'cloud/azure-open-nsg',
    title: 'Azure NSG allows any source',
    severity: 'critical',
    regex: /source_address_prefix\s*=\s*"\*"|SourceAddressPrefix:\s*'\*'/i,
    message: 'Network security group allows any source — scope to required IP ranges.',
    provider: 'Azure',
  },
];

function isIaCFile(file: string): boolean {
  return IAC_PATTERN.test(file) || IAC_NAME.test(file);
}

function scanFile(file: string, content: string, scanId: string): FindingDraft[] {
  if (!isIaCFile(file)) return [];

  const drafts: FindingDraft[] = [];
  for (const rule of RULES) {
    const match = rule.regex.exec(content);
    if (!match) continue;
    drafts.push({
      severity: rule.severity,
      ruleId: rule.id,
      title: rule.title,
      file,
      line: lineNumberAt(content, match.index),
      message: `[${rule.provider}] ${rule.message}`,
      snippet: snippetAround(content, match.index),
    });
    rule.regex.lastIndex = 0;
  }
  return drafts;
}

export async function scanCloudDirectory(
  rootDir: string,
  repoLabel: string,
  branch = 'main'
): Promise<ScanResult> {
  const scanId = randomUUID();
  const files = walkFiles(rootDir);
  const drafts: FindingDraft[] = [];

  for (const file of files) {
    const content = readRepoFile(rootDir, file);
    if (!content) continue;
    drafts.push(...scanFile(file, content, scanId));
  }

  const findings: Finding[] = drafts.map((draft) =>
    attachRemediation({
      ...draft,
      id: randomUUID(),
      scanId,
      fixed: false,
    })
  );

  const now = new Date().toISOString();
  return {
    id: scanId,
    module: 'cloud',
    repo: repoLabel,
    branch,
    status: 'complete',
    startedAt: now,
    completedAt: now,
    findings,
    stats: calcStats(findings),
  };
}
