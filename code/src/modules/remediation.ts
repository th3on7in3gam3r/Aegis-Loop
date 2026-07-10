import type { FindingRemediation } from '../types.js';

const REMEDIATION: Record<string, FindingRemediation> = {
  'cloud/s3-public-acl': {
    summary: 'Block public read on S3 buckets and enforce bucket-level public access blocks.',
    steps: [
      'Set `block_public_acls = true` and `ignore_public_acls = true` on the bucket resource.',
      'Remove `acl = "public-read"` or `public-read-write` from bucket definitions.',
      'Use IAM policies for intentional sharing instead of public ACLs.',
      'Re-run the Cloud scan after your IaC change merges.',
    ],
  },
  'cloud/sg-open-world': {
    summary: 'Restrict security group ingress to known CIDR ranges — not 0.0.0.0/0.',
    steps: [
      'Replace `0.0.0.0/0` or `::/0` with your office VPN, VPC CIDR, or load balancer subnet.',
      'Use a bastion or VPN for admin access instead of world-open SSH/RDP.',
      'Sync Protect rules after fixing to block metadata SSRF probes at runtime.',
    ],
  },
  'cloud/iam-wildcard': {
    summary: 'Replace wildcard IAM actions with least-privilege permission lists.',
    steps: [
      'List the specific API actions the role needs (e.g. `s3:GetObject` on one bucket ARN).',
      'Remove `"Action": "*"` from policy documents.',
      'Split admin roles from application runtime roles.',
    ],
  },
  'cloud/k8s-public-lb': {
    summary: 'Confirm the service must be public; otherwise use ClusterIP or internal LB.',
    steps: [
      'Change `type: LoadBalancer` to `ClusterIP` if traffic should stay in-cluster.',
      'Add an Ingress with TLS and authentication for external access.',
      'Apply NetworkPolicies to limit pod ingress to the namespace.',
    ],
  },
  'cloud/docker-exposed-port': {
    summary: 'Bind container ports to localhost unless external access is required.',
    steps: [
      'Use `127.0.0.1:8080:8080` instead of `0.0.0.0:8080:8080` in compose files.',
      'Put nginx or a reverse proxy in front for public traffic with TLS.',
    ],
  },
  'cloud/gcp-public-bucket': {
    summary: 'Remove public GCS principals and enable uniform bucket-level access.',
    steps: [
      'Remove `allUsers` and `allAuthenticatedUsers` from IAM bindings.',
      'Set `uniform_bucket_level_access = true`.',
      'Use signed URLs or IAM for intentional external access.',
    ],
  },
  'cloud/azure-open-nsg': {
    summary: 'Scope Azure NSG rules to required source IP ranges.',
    steps: [
      'Replace `source_address_prefix = "*"` with specific CIDR blocks.',
      'Document why each open port is required in change tickets.',
    ],
  },
  'attack/plain-http': {
    summary: 'Force HTTPS for all user-facing traffic.',
    steps: [
      'Add an HTTP → HTTPS redirect at your CDN, load balancer, or web server.',
      'Ensure TLS certificates are valid and auto-renewed.',
      'Re-probe the URL after deploy to confirm the finding clears.',
    ],
  },
  'attack/missing-hsts': {
    summary: 'Add Strict-Transport-Security so browsers always use HTTPS.',
    steps: [
      'Set `Strict-Transport-Security: max-age=31536000; includeSubDomains` on HTTPS responses.',
      'Configure at Cloudflare, Vercel, nginx, or your CDN edge.',
    ],
  },
  'attack/missing-csp': {
    summary: 'Add Content-Security-Policy to limit script and resource origins.',
    steps: [
      'Start with `Content-Security-Policy-Report-Only` to find breakages.',
      'Move to enforcing `default-src \'self\'` once validated.',
    ],
  },
  'attack/missing-xfo': {
    summary: 'Prevent clickjacking with X-Frame-Options or CSP frame-ancestors.',
    steps: [
      'Add `X-Frame-Options: SAMEORIGIN` or `Content-Security-Policy: frame-ancestors \'self\'`.',
    ],
  },
  'attack/missing-xcto': {
    summary: 'Add nosniff to reduce MIME confusion attacks.',
    steps: [
      'Set `X-Content-Type-Options: nosniff` on all HTML/API responses.',
    ],
  },
  'attack/server-disclosure': {
    summary: 'Reduce information leaked in the Server response header.',
    steps: [
      'Set `server_tokens off;` in nginx or strip the header at your CDN.',
      'Avoid exposing version numbers in error pages.',
    ],
  },
  'attack/error-leak': {
    summary: 'Fix the underlying error causing HTTP 5xx responses.',
    steps: [
      'Check application and server logs for the failing route.',
      'Return generic error pages in production — no stack traces.',
    ],
  },
  'bug/empty-catch': {
    summary: 'Never swallow errors silently — log, report, or rethrow.',
    steps: [
      'Replace empty catch bodies with structured logging (e.g. console.error or your logger).',
      'If the error is unexpected, rethrow or return a failed result to the caller.',
      'Add a test that triggers the failure path so regressions are caught.',
    ],
  },
  'bug/loose-equality': {
    summary: 'Use strict equality unless you explicitly need type coercion.',
    steps: [
      'Replace == with === and != with !==.',
      'If you compare to null/undefined, prefer `value == null` only when you mean both.',
      'Run tests after the change — strict equality can surface latent type bugs.',
    ],
  },
  'bug/parseint-no-radix': {
    summary: 'Always pass a radix to parseInt.',
    steps: [
      'Use parseInt(value, 10) for decimal user input.',
      'Use parseInt(hex, 16) for hexadecimal strings.',
      'Consider Number() or parseFloat when you need floating-point values.',
    ],
  },
  'bug/console-log': {
    summary: 'Remove or gate debug logging before production.',
    steps: [
      'Delete console.log calls used during development.',
      'Replace with a logger that supports levels (debug/info/warn/error).',
      'Gate verbose logs behind NODE_ENV !== "production" or a feature flag.',
    ],
  },
  'bug/foreach-async': {
    summary: 'Do not use async callbacks with Array.forEach.',
    steps: [
      'Use `for (const item of items) { await work(item); }` for sequential async work.',
      'Use `await Promise.all(items.map(async (item) => ...))` for parallel work.',
      'Handle errors with try/catch around the loop or .catch on Promise.all.',
    ],
  },
  'bug/assignment-in-condition': {
    summary: 'Assignment inside if is almost always a typo.',
    steps: [
      'If you meant comparison, use === or !==.',
      'If assignment was intentional, move it above the if and compare separately.',
      'Enable eslint no-cond-assign to catch this automatically.',
    ],
  },
  'bug/throw-literal': {
    summary: 'Throw Error objects so stack traces are preserved.',
    steps: [
      'Replace throw "message" with throw new Error("message").',
      'For custom error types, extend Error and set .name.',
      'Ensure monitoring tools can read err.stack in production.',
    ],
  },
};

export function remediationForRule(ruleId: string): FindingRemediation | undefined {
  return REMEDIATION[ruleId];
}

export function attachRemediation<T extends { ruleId: string; remediation?: FindingRemediation }>(
  finding: T
): T {
  const remediation = remediationForRule(finding.ruleId);
  return remediation ? { ...finding, remediation } : finding;
}
