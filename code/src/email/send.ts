import {
  emailFromAddress,
  isEmailConfigured,
  resendApiKey,
  resendTestFromAddress,
} from './config.js';

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  fromName?: string;
  replyTo?: string;
  allowTestFromFallback?: boolean;
};

export type SendEmailResult = {
  ok: boolean;
  error?: string;
  id?: string;
  usedTestFrom?: boolean;
};

const DOMAIN_VERIFY_PATTERNS = [
  /domain is not verified/i,
  /verify your domain/i,
  /not authorized to send/i,
];

function isDomainVerificationError(message: string): boolean {
  return DOMAIN_VERIFY_PATTERNS.some((p) => p.test(message));
}

function applyFromName(baseFrom: string, fromName?: string): string {
  if (!fromName?.trim()) return baseFrom;
  const match = baseFrom.match(/<([^>]+)>/);
  const email = match?.[1]?.trim() ?? baseFrom.trim();
  return `${fromName.trim()} <${email}>`;
}

export function isValidRecipientEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

async function sendViaResend(
  input: SendEmailInput,
  from: string
): Promise<{ ok: boolean; error?: string; rawError?: string; id?: string }> {
  const fromHeader = applyFromName(from, input.fromName);
  const replyTo =
    input.replyTo?.trim() && isValidRecipientEmail(input.replyTo)
      ? input.replyTo.trim()
      : undefined;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromHeader,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        reply_to: replyTo,
      }),
    });

    const data = (await res.json()) as { id?: string; message?: string; name?: string };
    if (!res.ok) {
      const raw = data.message ?? data.name ?? JSON.stringify(data);
      console.error('[email] Resend error', { from: fromHeader, to: input.to, raw });
      return { ok: false, rawError: raw, error: raw };
    }
    return { ok: true, id: data.id };
  } catch (err) {
    const raw = err instanceof Error ? err.message : 'Resend request failed';
    console.error('[email] Resend exception', { from: fromHeader, to: input.to, raw });
    return { ok: false, rawError: raw, error: raw };
  }
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (!isEmailConfigured()) {
    console.warn('[email] skipped — RESEND_API_KEY not set');
    return { ok: false, error: 'Email not configured' };
  }

  const primaryFrom = emailFromAddress();
  const primary = await sendViaResend(input, primaryFrom);
  if (primary.ok) return primary;

  const shouldRetryWithTestFrom =
    primary.rawError &&
    isDomainVerificationError(primary.rawError) &&
    (input.allowTestFromFallback ||
      process.env.RESEND_USE_TEST_FROM === '1' ||
      process.env.NODE_ENV !== 'production');

  if (!shouldRetryWithTestFrom) return primary;

  const testFrom = resendTestFromAddress();
  if (testFrom === primaryFrom) return primary;

  console.warn('[email] retrying with Resend test sender');
  const fallback = await sendViaResend(input, testFrom);
  if (fallback.ok) return { ...fallback, usedTestFrom: true };
  return fallback;
}
