import { randomBytes } from 'node:crypto';
import { config, oauthConfigured } from '../config.js';
import { createOctokit, verifyToken } from './client.js';
import type { GitHubSession } from '../types.js';

const oauthStates = new Map<string, number>();
const STATE_TTL_MS = 10 * 60 * 1000;

export function isOAuthConfigured(): boolean {
  return oauthConfigured();
}

export function startOAuth(): string {
  const state = randomBytes(16).toString('hex');
  oauthStates.set(state, Date.now());

  const params = new URLSearchParams({
    client_id: config.github.clientId,
    redirect_uri: `${config.appUrl}/api/auth/github/callback`,
    scope: 'repo read:user',
    state,
  });

  return `https://github.com/login/oauth/authorize?${params}`;
}

export function consumeOAuthState(state: string): boolean {
  const created = oauthStates.get(state);
  oauthStates.delete(state);
  if (!created) return false;
  return Date.now() - created < STATE_TTL_MS;
}

export async function exchangeCode(code: string): Promise<GitHubSession> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: config.github.clientId,
      client_secret: config.github.clientSecret,
      code,
      redirect_uri: `${config.appUrl}/api/auth/github/callback`,
    }),
  });

  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!data.access_token) {
    throw new Error(data.error ?? 'OAuth token exchange failed');
  }

  const user = await verifyToken(data.access_token);
  return {
    token: data.access_token,
    login: user.login,
    name: user.name,
    avatarUrl: user.avatarUrl,
  };
}

export async function sessionFromPat(token: string): Promise<GitHubSession> {
  const user = await verifyToken(token);
  return {
    token,
    login: user.login,
    name: user.name,
    avatarUrl: user.avatarUrl,
  };
}

export { createOctokit, listUserRepos, verifyToken } from './client.js';
