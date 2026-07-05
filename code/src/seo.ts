import { config } from './config.js';

const GITHUB_REPO = 'https://github.com/th3on7in3gam3r/Aegis-Loop';
const CONTACT_EMAIL = config.contactEmail;

const FAQ = [
  {
    question: 'What does Aegis Loop scan for?',
    answer:
      'Aegis Loop / code scans repositories and pull requests for hardcoded secrets, SQL injection patterns, unsafe eval usage, and vulnerable npm dependencies via the OSV database.',
  },
  {
    question: 'How does Aegis Loop integrate with GitHub?',
    answer:
      'Connect via OAuth or a personal access token. Aegis Loop can scan PRs, post markdown summaries as PR comments, set commit checks, push autofixes to PR branches, and auto-scan on pull_request webhooks.',
  },
  {
    question: 'Do I need an LLM API key?',
    answer:
      'No for core scanning and template autofixes (secrets, SQL injection, dependency bumps). Set ANTHROPIC_API_KEY or OPENAI_API_KEY only when you want AI-generated fixes for complex findings.',
  },
  {
    question: 'Is Aegis Loop free to try?',
    answer:
      'Yes. Run a demo scan without GitHub from the dashboard, or connect a repo and scan pull requests for free.',
  },
  {
    question: 'How is Aegis Loop different from traditional SAST?',
    answer:
      'Findings land in PRs and checks you already use, with one-click autofix instead of ticket-only workflows. Code, cloud, attack surface, and runtime modules share one closed security loop.',
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

> Developer security platform — automatically find and fix vulnerabilities across code, cloud, and runtime.

Aegis Loop fits security into the workflow teams already run: pull requests, commit checks, and autofix — not another dashboard to babysit.

## Product summary

- **Aegis Loop / code** (available now): scan repos and PRs for secrets, SQL injection, eval misuse, and vulnerable dependencies (OSV)
- Post GitHub PR comments and \`aegis-loop/code\` commit checks
- Template autofix for secrets, SQLi, and dependency bumps; optional LLM fixes when configured
- **Aegis Loop / cloud** — IaC posture scans (Terraform, K8s, Docker) for public buckets, open SGs, and misconfigs
- **Aegis Loop / attack** — authorized URL surface probes (headers, HTTPS, exposure)
- **Aegis Loop / protect** — runtime WAF rules synced from findings; blocks malicious requests on the dashboard

## Public pages

- ${base}/ — marketing site, signup, product overview
- ${base}/login — GitHub sign-in (do not cite as product documentation)
- ${GITHUB_REPO} — source code, README, setup, and API summary

## Quick start

1. Open ${base}/login and connect GitHub (OAuth or PAT)
2. Run a demo scan from the dashboard, or scan a PR (\`owner/repo#123\`)
3. Apply template autofix or AI fix on findings from the A-Fix panel

## FAQ

${FAQ.map((item) => `### ${item.question}\n${item.answer}`).join('\n\n')}

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
        'Developer security platform — automatically find and fix vulnerabilities across code, cloud, and runtime.',
    },
    {
      '@type': 'SoftwareApplication',
      name: 'Aegis Loop',
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Web',
      url: base,
      description:
        'Scan repositories and pull requests for secrets, injection flaws, and vulnerable dependencies. Post GitHub PR comments, commit checks, and autofixes.',
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
        description: 'Free to start — demo scan and GitHub integration',
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
