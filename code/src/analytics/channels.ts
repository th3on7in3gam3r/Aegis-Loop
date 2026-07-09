export function classifyChannel(
  referrer: string | undefined,
  utm: { source?: string; medium?: string; campaign?: string },
): string {
  const medium = utm.medium?.toLowerCase() ?? '';
  const source = utm.source?.toLowerCase() ?? '';

  if (medium === 'cpc' || medium === 'ppc' || medium === 'paid' || medium === 'ads') {
    return 'Paid';
  }
  if (source) {
    if (source.includes('google')) return 'Organic Search';
    if (source.includes('github')) return 'GitHub';
    if (/twitter|x\.com|linkedin|facebook|instagram|reddit|youtube|tiktok/.test(source)) {
      return 'Social';
    }
    return source.charAt(0).toUpperCase() + source.slice(1);
  }
  if (!referrer?.trim()) return 'Direct';

  try {
    const host = new URL(referrer).hostname.toLowerCase();
    if (host.includes('google.') || host === 'google.com') return 'Organic Search';
    if (host.includes('bing.') || host.includes('duckduckgo')) return 'Organic Search';
    if (host.includes('github.')) return 'GitHub';
    if (/twitter\.com|x\.com|linkedin\.|facebook\.|instagram\.|reddit\.|youtube\.|tiktok\./.test(host)) {
      return 'Social';
    }
    return 'Referral';
  } catch {
    return 'Referral';
  }
}
