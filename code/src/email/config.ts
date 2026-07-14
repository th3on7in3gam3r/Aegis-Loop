import { config } from '../config.js';

const DEFAULT_FROM = 'Aegis Loop <notifications@aegis-loop.com>';
const TEST_FROM = 'Aegis Loop <onboarding@resend.dev>';

export function resendApiKey(): string | undefined {
  const key = process.env.RESEND_API_KEY?.trim();
  return key || undefined;
}

export function isEmailConfigured(): boolean {
  return Boolean(resendApiKey());
}

export function emailFromAddress(): string {
  return process.env.EMAIL_FROM?.trim() || DEFAULT_FROM;
}

export function resendTestFromAddress(): string {
  return TEST_FROM;
}

export function emailFromDomain(): string {
  const match = emailFromAddress().match(/<([^>]+)>/);
  const email = match?.[1]?.trim() ?? emailFromAddress();
  const at = email.lastIndexOf('@');
  return at === -1 ? 'aegis-loop.com' : email.slice(at + 1);
}

export function appDashboardUrl(path = '/app/'): string {
  const base = config.appUrl.replace(/\/$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

export function scanDashboardUrl(scan: {
  id: string;
  module?: import('../types.js').AegisModule;
}): string {
  const mod = scan.module ?? 'code';
  if (mod === 'code') {
    return appDashboardUrl(`/app/?scan=${encodeURIComponent(scan.id)}&view=findings`);
  }
  return appDashboardUrl(`/app/?module=${mod}&scan=${encodeURIComponent(scan.id)}`);
}

export const EMAIL_BRAND = {
  name: 'Aegis Loop',
  primaryColor: '#7c3aed',
  siteUrl: 'https://aegis-loop.com',
} as const;
