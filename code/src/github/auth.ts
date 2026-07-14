import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config, oauthConfigured } from '../config.js';
import { createOctokit, verifyToken } from './client.js';
import type { GitHubSession } from '../types.js';

const OAUTH_STATE_COOKIE = 'aegis_oauth_state';
const STATE_TTL_SEC = 10 * 60;
const secureCookie = config.appUrl.startsWith('https://');

const oauthCookieOpts = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: secureCookie,
  path: '/',
  signed: true,
};

export function isOAuthConfigured(): boolean {
  return oauthConfigured();
}

export function startOAuth(reply: FastifyReply): string {
  const state = randomBytes(16).toString('hex');

  reply.setCookie(OAUTH_STATE_COOKIE, state, {
    ...oauthCookieOpts,
    maxAge: STATE_TTL_SEC,
  });

  const params = new URLSearchParams({
    client_id: config.github.clientId,
    redirect_uri: `${config.appUrl}/api/auth/github/callback`,
    scope: 'repo read:user user:email',
    state,
  });

  return `https://github.com/login/oauth/authorize?${params}`;
}

export function consumeOAuthState(
  req: FastifyRequest,
  reply: FastifyReply,
  state: string
): boolean {
  const raw = req.unsignCookie(req.cookies[OAUTH_STATE_COOKIE] ?? '');
  reply.clearCookie(OAUTH_STATE_COOKIE, oauthCookieOpts);

  if (!raw.valid || !raw.value || raw.value !== state) return false;
  return true;
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
