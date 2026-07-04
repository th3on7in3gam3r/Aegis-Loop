import { config } from './config.js';
import type { FastifyRequest } from 'fastify';
import type { GitHubSession } from './types.js';

const COOKIE = 'aegis_github';
const secureCookie = config.appUrl.startsWith('https://');

export function setSessionCookie(
  reply: { setCookie: (name: string, value: string, opts: object) => void },
  session: GitHubSession
): void {
  reply.setCookie(COOKIE, JSON.stringify(session), {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookie,
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
    signed: true,
  });
}

export function clearSessionCookie(
  reply: { clearCookie: (name: string, opts: object) => void }
): void {
  reply.clearCookie(COOKIE, {
    path: '/',
    signed: true,
    httpOnly: true,
    secure: secureCookie,
    sameSite: 'lax',
  });
}

export function getSession(req: FastifyRequest): GitHubSession | null {
  const raw = req.unsignCookie(req.cookies[COOKIE] ?? '');
  if (!raw.valid || !raw.value) return null;
  try {
    return JSON.parse(raw.value) as GitHubSession;
  } catch {
    return null;
  }
}

export function resolveToken(
  req: FastifyRequest,
  headerToken?: string,
  bodyToken?: string
): string | undefined {
  const session = getSession(req);
  return session?.token ?? headerToken ?? bodyToken;
}
