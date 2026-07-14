import { Octokit } from '@octokit/rest';

export function createOctokit(token?: string): Octokit {
  return new Octokit({ auth: token || undefined, userAgent: 'aegis-loop/code' });
}

export async function verifyToken(token: string): Promise<{
  login: string;
  name: string | null;
  avatarUrl: string;
}> {
  const octokit = createOctokit(token);
  const { data } = await octokit.users.getAuthenticated();
  return {
    login: data.login,
    name: data.name,
    avatarUrl: data.avatar_url,
  };
}

export async function fetchPrimaryEmail(token: string): Promise<string | null> {
  const octokit = createOctokit(token);
  try {
    const { data } = await octokit.users.listEmailsForAuthenticatedUser();
    const primary = data.find((e) => e.primary && e.verified);
    if (primary?.email) return primary.email;
    const verified = data.find((e) => e.verified);
    return verified?.email ?? null;
  } catch {
    return null;
  }
}

export async function listUserRepos(token: string) {
  const octokit = createOctokit(token);
  const repos: Array<{
    fullName: string;
    private: boolean;
    defaultBranch: string;
    url: string;
    updatedAt: string;
  }> = [];

  let page = 1;
  while (true) {
    const { data } = await octokit.repos.listForAuthenticatedUser({
      sort: 'updated',
      per_page: 100,
      page,
    });
    if (!data.length) break;

    repos.push(
      ...data.map((r) => ({
        fullName: r.full_name,
        private: r.private,
        defaultBranch: r.default_branch,
        url: r.html_url,
        updatedAt: r.updated_at ?? '',
      }))
    );

    if (data.length < 100) break;
    page += 1;
  }

  return repos;
}
