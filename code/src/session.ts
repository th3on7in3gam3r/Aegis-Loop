import { config } from './config.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { GitHubSession } from './types.js';
import { createServerSession, destroyServerSession, getServerSession } from './sessionStore.js';

const COOKIE = 'aegis_sid';
const LEGACY_COOKIE = 'aegis_github';
const secureCookie = config.appUrl.startsWith('https://');

const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: secureCookie,
  path: '/',
  signed: true,
};

export function setSessionCookie(reply: FastifyReply, session: GitHubSession): void {
  const sessionId = createServerSession(session);
  reply.setCookie(COOKIE, sessionId, {
    ...cookieOpts,
    maxAge: 60 * 60 * 24 * 7,
  });
}

export function clearSessionCookie(req: FastifyRequest, reply: FastifyReply): void {
  const raw = req.unsignCookie(req.cookies[COOKIE] ?? '');
  if (raw.valid && raw.value) destroyServerSession(raw.value);
  reply.clearCookie(COOKIE, cookieOpts);
  reply.clearCookie(LEGACY_COOKIE, cookieOpts);
}

export function getSession(req: FastifyRequest): GitHubSession | null {
  const raw = req.unsignCookie(req.cookies[COOKIE] ?? '');
  if (!raw.valid || !raw.value) return null;
  return getServerSession(raw.value);
}

export function requireSession(
  req: FastifyRequest,
  reply: FastifyReply
): GitHubSession | null {
  const session = getSession(req);
  if (!session) {
    reply.status(401).send({ error: 'Sign in required' });
    return null;
  }
  return session;
}

export function resolveToken(
  req: FastifyRequest,
  headerToken?: string,
  bodyToken?: string
): string | undefined {
  const session = getSession(req);
  return session?.token ?? headerToken ?? bodyToken;
}
