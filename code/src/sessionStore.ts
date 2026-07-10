import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';
import { dbConfigured, loadBlob, saveBlob } from './db.js';
import type { GitHubSession } from './types.js';

/**
 * Server-side session storage. The browser cookie only carries a random
 * session ID — GitHub access tokens never leave the server.
 */

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const STORE_FILE = join(config.dataDir, 'sessions.json');

interface StoredSession extends GitHubSession {
  id: string;
  expiresAt: number;
}

const sessions = new Map<string, StoredSession>();

const BLOB_NAME = 'sessions';

function persist(): void {
  if (dbConfigured()) {
    saveBlob(BLOB_NAME, [...sessions.values()]);
    return;
  }
  try {
    mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(STORE_FILE, JSON.stringify([...sessions.values()]));
  } catch {
    /* disk issue — sessions stay in-memory until next successful write */
  }
}

export async function loadSessionStore(): Promise<void> {
  let data: StoredSession[] | null = null;
  if (dbConfigured()) {
    data = await loadBlob<StoredSession[]>(BLOB_NAME);
  } else if (existsSync(STORE_FILE)) {
    try {
      data = JSON.parse(readFileSync(STORE_FILE, 'utf8')) as StoredSession[];
    } catch {
      /* corrupt — start fresh; users just re-login */
    }
  }
  if (!data) return;
  const now = Date.now();
  for (const s of data) {
    if (s.expiresAt > now) sessions.set(s.id, s);
  }
}

function pruneExpired(): void {
  const now = Date.now();
  let removed = false;
  for (const [id, s] of sessions) {
    if (s.expiresAt <= now) {
      sessions.delete(id);
      removed = true;
    }
  }
  if (removed) persist();
}

export function createServerSession(data: GitHubSession): string {
  pruneExpired();
  const id = randomBytes(32).toString('base64url');
  sessions.set(id, { ...data, id, expiresAt: Date.now() + SESSION_TTL_MS });
  persist();
  return id;
}

export function getServerSession(id: string): GitHubSession | null {
  const s = sessions.get(id);
  if (!s) return null;
  if (s.expiresAt <= Date.now()) {
    sessions.delete(id);
    persist();
    return null;
  }
  return { token: s.token, login: s.login, name: s.name, avatarUrl: s.avatarUrl };
}

export function destroyServerSession(id: string): void {
  if (sessions.delete(id)) persist();
}

export function destroySessionsForLogin(login: string): void {
  let removed = false;
  for (const [id, s] of sessions) {
    if (s.login === login) {
      sessions.delete(id);
      removed = true;
    }
  }
  if (removed) persist();
}
