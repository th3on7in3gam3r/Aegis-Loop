import type { FastifyReply, FastifyRequest } from 'fastify';
import { getSession } from '../session.js';
import { findAccountByApiKey, getAccount, type Account } from './store.js';

export interface AuthContext {
  login: string;
  account: Account;
  via: 'session' | 'apiKey';
}

function bearerToken(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice(7).trim();
}

export function resolveAuth(req: FastifyRequest): AuthContext | null {
  const session = getSession(req);
  if (session) {
    return { login: session.login, account: getAccount(session.login), via: 'session' };
  }
  const token = bearerToken(req);
  if (token) {
    const account = findAccountByApiKey(token);
    if (account) return { login: account.login, account, via: 'apiKey' };
  }
  return null;
}

export function requireAuth(req: FastifyRequest, reply: FastifyReply): AuthContext | null {
  const auth = resolveAuth(req);
  if (!auth) {
    reply.status(401).send({ error: 'Sign in or provide a valid API key (Authorization: Bearer aegis_…)' });
    return null;
  }
  return auth;
}
