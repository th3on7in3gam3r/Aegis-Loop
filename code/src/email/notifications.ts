import { config } from '../config.js';
import { getAccount } from '../billing/store.js';
import { isEmailConfigured } from './config.js';
import { sendEmail, isValidRecipientEmail } from './send.js';
import {
  buildContactConfirmationEmail,
  buildContactTeamEmail,
  type ContactFormInput,
} from './templates/contact.js';
import {
  buildScanCompleteEmail,
  topFindingTitles,
} from './templates/scan-complete.js';
import { listScans } from '../store.js';
import type { ScanResult } from '../types.js';

const SCORE_DROP_THRESHOLD = 5;

function previousScanScore(scan: ScanResult): number | null {
  const mod = scan.module ?? 'code';
  const key = mod === 'attack' ? scan.target : scan.repo;
  if (!key || !scan.userLogin) return null;

  const prior = listScans(mod, scan.userLogin).find((s) => {
    if (s.id === scan.id) return false;
    if (mod === 'attack') return s.target === scan.target;
    return s.repo === scan.repo;
  });

  return prior?.stats.score ?? null;
}

function recipientForLogin(login: string): string | null {
  const account = getAccount(login);
  if (account.scanEmailAlerts === false) return null;
  const email = account.email?.trim();
  return email && isValidRecipientEmail(email) ? email : null;
}

export async function notifyScanComplete(scan: ScanResult): Promise<void> {
  if (!isEmailConfigured() || !scan.userLogin) return;

  const to = recipientForLogin(scan.userLogin);
  if (!to) return;

  const previousScore = previousScanScore(scan);
  const score = scan.stats.score;
  const variant =
    previousScore != null && score < previousScore - SCORE_DROP_THRESHOLD
      ? ('score_drop' as const)
      : ('complete' as const);

  const { html, text, subject } = buildScanCompleteEmail({
    scan,
    topFindings: topFindingTitles(scan),
    previousScore,
    variant,
  });

  await sendEmail({ to, subject, html, text });
}

export function queueScanCompleteEmail(scan: ScanResult): void {
  void notifyScanComplete(scan).catch((err) => {
    console.error('[email] scan complete failed', err);
  });
}

export async function sendContactEmails(input: ContactFormInput): Promise<{
  ok: boolean;
  error?: string;
}> {
  if (!isEmailConfigured()) {
    return { ok: false, error: 'Email not configured on this server' };
  }

  const team = buildContactTeamEmail(input);
  const teamResult = await sendEmail({
    to: config.contactEmail,
    subject: team.subject,
    html: team.html,
    text: team.text,
    replyTo: input.email,
  });

  if (!teamResult.ok) {
    return { ok: false, error: teamResult.error ?? 'Could not deliver message' };
  }

  const confirm = buildContactConfirmationEmail(input);
  await sendEmail({
    to: input.email,
    subject: confirm.subject,
    html: confirm.html,
    text: confirm.text,
    replyTo: config.contactEmail,
    allowTestFromFallback: true,
  });

  return { ok: true };
}
