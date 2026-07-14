import { config } from '../config.js';
import { UTM, withUtm, type UtmParams } from '../utm.js';

const DEFAULT_FROM = 'Aegis Loop <notifications@aegis-loop.com>';
const TEST_FROM = 'Aegis Loop <onboarding@resend.dev>';

export const EMAIL_BRAND = {
  name: 'Aegis Loop',
  primaryColor: '#7c3aed',
  siteUrl: 'https://aegis-loop.com',
} as const;

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

export function appDashboardUrl(path = '/app/', utm?: UtmParams): string {
  const base = config.appUrl.replace(/\/$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  const url = `${base}${suffix}`;
  return utm ? withUtm(url, utm) : url;
}

export function scanDashboardUrl(
  scan: {
    id: string;
    module?: import('../types.js').AegisModule;
  },
  utm: UtmParams = UTM.emailScanComplete
): string {
  const mod = scan.module ?? 'code';
  if (mod === 'code') {
    return appDashboardUrl(
      `/app/?scan=${encodeURIComponent(scan.id)}&view=findings`,
      utm
    );
  }
  return appDashboardUrl(
    `/app/?module=${mod}&scan=${encodeURIComponent(scan.id)}`,
    utm
  );
}

export function marketingSiteUrl(utm: UtmParams = UTM.emailFooter): string {
  return withUtm(`${EMAIL_BRAND.siteUrl}/`, utm);
}
