/**
 * Growth Stack UTM helpers for Pulse campaign → landing attribution.
 * Pulse reads utm_source / utm_campaign / utm_medium / utm_content on pageviews.
 */

export type UtmSource =
  | 'cadence'
  | 'kerygma'
  | 'citepilot'
  | 'aegis'
  | 'github'
  | 'email'
  | (string & {});

export type UtmParams = {
  source: UtmSource;
  campaign: string;
  medium?: 'email' | 'social' | 'cpc' | 'referral' | (string & {});
  content?: string;
};

/** Named campaigns used across Aegis Loop outbound links. */
export const UTM = {
  cadenceUrlCheck: {
    source: 'cadence',
    campaign: 'url-check',
    medium: 'referral',
  },
  emailScanComplete: {
    source: 'aegis',
    campaign: 'scan-complete',
    medium: 'email',
  },
  emailScoreAlert: {
    source: 'aegis',
    campaign: 'score-alert',
    medium: 'email',
  },
  emailContactConfirm: {
    source: 'aegis',
    campaign: 'contact-confirm',
    medium: 'email',
  },
  emailFooter: {
    source: 'aegis',
    campaign: 'email-footer',
    medium: 'email',
  },
  githubPrComment: {
    source: 'github',
    campaign: 'pr-comment',
    medium: 'referral',
  },
} as const satisfies Record<string, UtmParams>;

/**
 * Append UTM query params without stripping existing query/hash.
 * Existing utm_* values are left untouched.
 */
export function withUtm(url: string, params: UtmParams): string {
  const base = url.trim();
  if (!base) return base;

  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    try {
      parsed = new URL(base, 'https://aegis-loop.com');
    } catch {
      return base;
    }
  }

  if (!parsed.searchParams.has('utm_source')) {
    parsed.searchParams.set('utm_source', params.source.toLowerCase());
  }
  if (!parsed.searchParams.has('utm_campaign')) {
    parsed.searchParams.set('utm_campaign', params.campaign);
  }
  if (params.medium && !parsed.searchParams.has('utm_medium')) {
    parsed.searchParams.set('utm_medium', params.medium);
  }
  if (params.content && !parsed.searchParams.has('utm_content')) {
    parsed.searchParams.set('utm_content', params.content);
  }

  return parsed.toString();
}
