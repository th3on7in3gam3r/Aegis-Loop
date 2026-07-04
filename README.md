# Aegis Loop

Developer security platform — automatically find and fix vulnerabilities across code, cloud, and runtime.

## What's here

| Path | Description |
|------|-------------|
| `index.html` | Marketing landing page (served at `/`) |
| `code/` | **Aegis Loop / code** — repo scanner, dashboard, autofix |

## Routes

| URL | Page |
|-----|------|
| `/` | Marketing landing |
| `/login` | GitHub sign-in (OAuth or PAT) |
| `/app/` | Security dashboard (feed, scans, autofix) |

## Aegis Loop / code

Scan repositories and pull requests for secrets, injection patterns, and vulnerable dependencies (via [OSV](https://google.github.io/osv.dev/)). Post results to GitHub PRs as comments + commit checks. Push autofixes directly to PR branches or generate fixes with an LLM.

### Run locally

```bash
cd code
cp .env.example .env.local   # first time only — then edit .env.local
npm install
npm run dev
```

Open **http://localhost:3847/login** to sign in, or **http://localhost:3847/app** for the dashboard.

### Quick start

1. **Demo scan** — click **Demo** (no GitHub needed)
2. **Connect GitHub** — OAuth at `/login` or paste a PAT in the dashboard
3. **Scan a PR** — **+ Scan** → Pull Request tab → `owner/repo#123` or PR URL
4. **Autofix** — template fixes for secrets/deps; **AI Fix** when `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is set

### CLI

```bash
cd code
npm run scan:demo              # scan bundled fixture repo
npm run scan:demo /path/to/repo
```

### GitHub integration

| Feature | How |
|---------|-----|
| **Connect account** | OAuth (`GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET`) or PAT |
| **Scan PR** | Clones PR head branch, scans, optional comment + check |
| **PR comment** | Markdown summary; updates existing bot comment |
| **Commit check** | `aegis-loop/code` status on PR head commit |
| **Autofix on PR** | Commits fix directly to PR branch |
| **Webhooks** | Auto-scan on `pull_request` opened/synchronize |

#### OAuth setup

1. Create a GitHub OAuth App: https://github.com/settings/developers
2. Callback URL: `http://localhost:3847/api/auth/github/callback`
3. Add to `.env.local`:

```bash
GITHUB_CLIENT_ID=Ov23li...
GITHUB_CLIENT_SECRET=...
APP_URL=http://localhost:3847
SESSION_SECRET=random-string
```

#### Webhook setup (auto-scan on every PR)

1. Expose your server publicly (ngrok, Cloudflare Tunnel, etc.)
2. Add repo webhook: `https://YOUR_URL/api/webhooks/github`
3. Secret → `GITHUB_WEBHOOK_SECRET` in `.env.local`
4. Events: **Pull requests**
5. Set `GITHUB_TOKEN` (PAT with repo access) for the server to clone and comment

#### LLM autofix

Set one provider in `.env.local`:

```bash
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
# or
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

### Scanner rules

- **Secrets** — AWS keys, Stripe keys, hardcoded passwords/API keys (template autofix → env vars)
- **Injection** — SQL string interpolation (parameterized query autofix), `eval()` (AI fix)
- **Dependencies** — live OSV lookup for npm packages in `package.json` (version bump autofix)

### API (summary)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Status, GitHub/AI/OSV config |
| GET | `/api/auth/me` | Current session |
| POST | `/api/auth/pat` | Connect with PAT |
| POST | `/api/auth/logout` | Clear session |
| GET | `/api/github/repos` | List repos (authenticated) |
| GET | `/api/scans` | List scans |
| POST | `/api/scans/demo` | Run demo scan |
| POST | `/api/scans` | Scan `{ repo, branch }` |
| POST | `/api/scans/pull-request` | Scan PR |
| POST | `/api/scans/:id/findings/:fid/autofix/generate` | Preview AI fix |
| POST | `/api/scans/:id/findings/:fid/autofix` | Apply fix |

Scans persist to `code/data/scans.json` across server restarts.

## Next modules

- Aegis Loop / cloud
- Aegis Loop / attack
- Aegis Loop / protect
