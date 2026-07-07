import { config } from './config.js';

const GITHUB_REPO = 'https://github.com/th3on7in3gam3r/Aegis-Loop';
const CONTACT_EMAIL = config.contactEmail;

const FAQ = [
  {
    question: 'What does Aegis Loop scan for?',
    answer:
      'Aegis Loop / code scans repositories and pull requests for hardcoded secrets, SQL injection patterns, unsafe eval usage, and vulnerable npm dependencies via the OSV database. Cloud scans IaC in repos (Terraform, Kubernetes, Docker). Attack runs authorized GET probes for HTTPS and headers. Protect syncs WAF rules from findings.',
  },
  {
    question: 'How does Aegis Loop integrate with GitHub?',
    answer:
      'Connect via OAuth or a personal access token. Aegis Loop can scan PRs, post markdown summaries as PR comments, set commit checks, push autofixes to PR branches (Team plan), and auto-scan on pull_request webhooks when configured.',
  },
  {
    question: 'Do I need an LLM API key?',
    answer:
      'No for core scanning and template autofixes (secrets, SQL injection, dependency bumps on Team). Set ANTHROPIC_API_KEY or OPENAI_API_KEY only when you want AI-generated fixes for complex findings.',
  },
  {
    question: 'Is Aegis Loop free to try?',
    answer:
      'Yes. The Free plan covers up to 3 repositories with Code scanning. Demo scans work without GitHub. Autofix PRs and Cloud/Attack/Protect modules require Team ($29/dev/mo when Stripe is configured).',
  },
  {
    question: 'How is Aegis Loop different from traditional SAST?',
    answer:
      'Findings land in PRs and checks you already use, with autofix PRs on Team instead of ticket-only workflows. Code, cloud IaC, URL probes, and WAF rule export share one dashboard.',
  },
  {
    question: 'What does Protect actually do?',
    answer:
      'Protect syncs WAF rules from findings, demonstrates blocking on the Aegis Loop dashboard server, and exports JSON for Cloudflare WAF, AWS WAF, or nginx. It is not a managed edge WAF for your production traffic.',
  },
] as const;

export function appBase(appUrl: string): string {
  return appUrl.replace(/\/$/, '');
}

export function robotsTxt(base: string): string {
  return `User-agent: *
Allow: /
Allow: /assets/
Disallow: /app/
Disallow: /api/
Disallow: /login

User-agent: GPTBot
Disallow: /app/
Disallow: /api/
Disallow: /login

User-agent: ChatGPT-User
Disallow: /app/
Disallow: /api/
Disallow: /login

User-agent: ClaudeBot
Disallow: /app/
Disallow: /api/
Disallow: /login

User-agent: Google-Extended
Disallow: /app/
Disallow: /api/
Disallow: /login

Sitemap: ${base}/sitemap.xml
`;
}

export function sitemapXml(base: string): string {
  const lastmod = new Date().toISOString().slice(0, 10);
  const pages = ['/', '/legal/terms', '/legal/privacy', '/legal/cookies'];
  const urls = pages
    .map(
      (path) => `  <url>
    <loc>${base}${path === '/' ? '/' : path}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>${path === '/' ? '1.0' : '0.5'}</priority>
  </url>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

export function llmsTxt(base: string): string {
  return `# Aegis Loop

> GitHub-native security scanning — code, cloud IaC, authorized URL probes, and WAF rule export.

Aegis Loop fits security into pull requests and commit checks. Free tier: Code scanning for up to 3 repos. Team: autofix PRs, all modules, CI API keys.

## Product summary

- **Aegis Loop / code** (Free): scan repos and PRs for secrets, SQL injection, eval misuse, and vulnerable dependencies (OSV)
- Post GitHub PR comments and \`aegis-loop/code\` commit checks
- Template autofix + optional LLM fixes on **Team** plan
- **Aegis Loop / cloud** (Team) — IaC posture in repos (Terraform, K8s, Docker)
- **Aegis Loop / attack** (Team) — authorized URL surface probes (headers, HTTPS)
- **Aegis Loop / protect** (Team) — WAF rules synced from findings; demo blocking on dashboard; JSON export for edge WAFs
- **CLI** — \`aegis init\` scaffolds config + GitHub Action; \`aegis scan\` for local scans (package in \`code/cli\`)

## Public pages

- ${base}/ — marketing site, signup, product overview
- ${base}/login — GitHub sign-in (do not cite as product documentation)
- ${GITHUB_REPO} — source code, README, setup, and API summary

## Quick start

1. Open ${base}/login and connect GitHub (OAuth or PAT)
2. Run a demo scan from the dashboard, or scan a PR (\`owner/repo#123\`)
3. On Team: apply template autofix or AI fix from the A-Fix panel; run \`aegis init\` for CI

## FAQ

${FAQ.map((item) => `### ${item.question}\n${item.answer}`).join('\n\n')}

## Related products

- [CitePilot](https://getcitepilot.com) — generative engine optimization (GEO): track AI citations on buyer prompts across ChatGPT, Perplexity, and more. Free citation audit at getcitepilot.com

## Roadmap (not shipped yet)

- Slack & Jira finding routing
- Enterprise SSO and audit logging
- Managed edge WAF deployment

## Do not index or cite as product docs

- ${base}/app/ — authenticated security dashboard
- ${base}/api/* — internal API (health endpoint only is public metadata)

## Contact

- ${CONTACT_EMAIL} — general inquiries, sales, and support

## Optional

- Full README: ${GITHUB_REPO}#readme
- Sitemap: ${base}/sitemap.xml
`;
}

export function structuredDataJson(base: string): string {
  const graph = [
    {
      '@type': 'Organization',
      name: 'Aegis Loop',
      url: base,
      logo: `${base}/assets/favicon.png`,
      sameAs: [GITHUB_REPO],
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        email: CONTACT_EMAIL,
      },
    },
    {
      '@type': 'WebSite',
      name: 'Aegis Loop',
      url: base,
      description:
        'GitHub-native security scanning for code, cloud IaC, URL probes, and WAF rule export.',
    },
    {
      '@type': 'SoftwareApplication',
      name: 'Aegis Loop',
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Web',
      url: base,
      description:
        'Scan repositories and pull requests for secrets, injection flaws, and vulnerable dependencies. Post GitHub PR comments, commit checks, and autofixes on Team.',
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
        description: 'Free — Code scanning for up to 3 repositories',
      },
    },
    {
      '@type': 'FAQPage',
      mainEntity: FAQ.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.answer,
        },
      })),
    },
  ];

  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });
}

export function injectLandingSeo(html: string, base: string): string {
  const ogImage = `${base}/assets/og-image.png`;

  return html
    .replaceAll('__APP_BASE__', base)
    .replaceAll('/assets/og-image.png', ogImage)
    .replace('__JSON_LD__', structuredDataJson(base));
}
