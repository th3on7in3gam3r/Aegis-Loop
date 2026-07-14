const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(raw: string): string {
  return raw.replace(/[&<>"']/g, (ch) => HTML_ESCAPE[ch] ?? ch);
}

export type EmailCta = {
  href: string;
  label: string;
};

export type EmailShellOptions = {
  preheader?: string;
  title: string;
  bodyHtml: string;
  primaryColor?: string;
  logoUrl?: string;
  logoAlt?: string;
  headerEyebrow?: string;
  footerPrimary?: string;
  footerSecondary?: string;
  /** Tagged marketing site URL for footer brand link */
  footerHref?: string;
  cta?: EmailCta;
  secondaryCta?: EmailCta;
};

const DEFAULT_PRIMARY = '#7c3aed';
const INK = '#0f172a';
const MUTED = '#64748b';
const BORDER = '#e2e8f0';
const SURFACE = '#f8fafc';

export function buildEmailShell(options: EmailShellOptions): string {
  const primary = options.primaryColor ?? DEFAULT_PRIMARY;
  const logoAlt = escapeHtml(options.logoAlt ?? 'Aegis Loop');
  const title = escapeHtml(options.title);
  const eyebrow = options.headerEyebrow
    ? `<p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${primary}">${escapeHtml(options.headerEyebrow)}</p>`
    : '';

  const logoBlock = options.logoUrl
    ? `<img src="${escapeHtml(options.logoUrl)}" alt="${logoAlt}" width="140" style="display:block;max-width:140px;height:auto;border:0" />`
    : `<p style="margin:0;font-size:20px;font-weight:800;color:${INK};letter-spacing:-0.02em">${logoAlt}</p>`;

  const preheader = options.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(options.preheader)}</div>`
    : '';

  const ctaBlock = options.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 0"><tr>
<td style="border-radius:999px;background:${primary}">
<a href="${escapeHtml(options.cta.href)}" style="display:inline-block;padding:14px 28px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px">${escapeHtml(options.cta.label)}</a>
</td></tr></table>`
    : '';

  const secondaryCtaBlock = options.secondaryCta
    ? `<p style="margin:16px 0 0;font-size:13px"><a href="${escapeHtml(options.secondaryCta.href)}" style="color:${primary};font-weight:600;text-decoration:none">${escapeHtml(options.secondaryCta.label)} →</a></p>`
    : '';

  const footerHref = escapeHtml(options.footerHref ?? 'https://aegis-loop.com/');
  const footerPrimary = options.footerPrimary
    ? `<p style="margin:0;font-size:12px;color:${MUTED};font-weight:600">${escapeHtml(options.footerPrimary)}</p>`
    : `<p style="margin:0;font-size:12px;color:${MUTED}">Aegis Loop · <a href="${footerHref}" style="color:${primary};text-decoration:none">aegis-loop.com</a></p>`;

  const footerSecondary = options.footerSecondary
    ? `<p style="margin:6px 0 0;font-size:10px;color:#94a3b8">${escapeHtml(options.footerSecondary)}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:${SURFACE};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SURFACE};padding:32px 16px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid ${BORDER};border-radius:16px;overflow:hidden">
<tr><td style="height:4px;background:${primary};font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:28px 28px 0">${logoBlock}</td></tr>
<tr><td style="padding:20px 28px 0">
${eyebrow}
<h1 style="margin:0;font-size:24px;line-height:1.25;font-weight:800;color:${INK};letter-spacing:-0.02em">${title}</h1>
</td></tr>
<tr><td style="padding:8px 28px 28px">
${options.bodyHtml}
${ctaBlock}
${secondaryCtaBlock}
</td></tr>
<tr><td style="padding:20px 28px 28px;border-top:1px solid ${BORDER};background:#fafbfc">
${footerPrimary}
${footerSecondary}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export function emailStatCard(input: {
  label: string;
  value: string;
  hint?: string;
  accent?: string;
}): string {
  const accent = input.accent ?? DEFAULT_PRIMARY;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0;background:${SURFACE};border:1px solid ${BORDER};border-radius:12px">
<tr><td style="padding:20px 22px">
<p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED}">${escapeHtml(input.label)}</p>
<p style="margin:8px 0 0;font-size:36px;line-height:1;font-weight:800;color:${accent};letter-spacing:-0.03em">${escapeHtml(input.value)}</p>
${input.hint ? `<p style="margin:8px 0 0;font-size:13px;color:${MUTED}">${input.hint}</p>` : ''}
</td></tr>
</table>`;
}

export function emailSectionTitle(label: string): string {
  return `<p style="margin:28px 0 10px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED}">${escapeHtml(label)}</p>`;
}

export function emailBulletList(items: string[], accent = DEFAULT_PRIMARY): string {
  if (items.length === 0) return '';
  const rows = items
    .map(
      (item, i) =>
        `<tr><td style="padding:10px 0;${i < items.length - 1 ? `border-bottom:1px solid ${BORDER};` : ''}vertical-align:top;width:28px;font-size:14px;font-weight:800;color:${accent}">${i + 1}</td><td style="padding:10px 0;${i < items.length - 1 ? `border-bottom:1px solid ${BORDER};` : ''}font-size:14px;line-height:1.5;color:${INK}">${escapeHtml(item)}</td></tr>`
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0">${rows}</table>`;
}

export function emailTagRow(labels: string[]): string {
  if (labels.length === 0) return '';
  const tags = labels
    .map(
      (label) =>
        `<span style="display:inline-block;margin:0 6px 6px 0;padding:6px 12px;background:${SURFACE};border:1px solid ${BORDER};border-radius:999px;font-size:12px;font-weight:600;color:${INK}">${escapeHtml(label)}</span>`
    )
    .join('');
  return `<div style="margin:0">${tags}</div>`;
}
