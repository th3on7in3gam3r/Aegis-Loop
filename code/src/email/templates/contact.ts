import { config } from '../../config.js';
import { UTM } from '../../utm.js';
import { EMAIL_BRAND, appDashboardUrl, marketingSiteUrl } from '../config.js';
import { buildEmailShell, escapeHtml } from './base-layout.js';

export type ContactFormInput = {
  name: string;
  email: string;
  topic: string;
  message: string;
};

function topicLabel(topic: string): string {
  const labels: Record<string, string> = {
    sales: 'Sales',
    support: 'Support',
    demo: 'Book a demo',
    enterprise: 'Enterprise',
    other: 'General',
  };
  return labels[topic] ?? topic;
}

export function buildContactConfirmationEmail(input: ContactFormInput): {
  html: string;
  text: string;
  subject: string;
} {
  const topic = topicLabel(input.topic);
  const dashUrl = appDashboardUrl('/app/', {
    ...UTM.emailContactConfirm,
    content: 'cta-primary',
  });
  const bodyHtml = `
<p style="margin:20px 0 0;font-size:15px;line-height:1.6;color:#0f172a">Hi ${escapeHtml(input.name)},</p>
<p style="margin:16px 0 0;font-size:15px;line-height:1.6;color:#475569">Thanks for reaching out about <strong style="color:#0f172a">${escapeHtml(topic)}</strong>. We've received your message and will reply within one business day.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px">
<tr><td style="padding:18px 20px">
<p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#64748b">Your message</p>
<p style="margin:0;font-size:14px;line-height:1.6;color:#0f172a;white-space:pre-wrap">${escapeHtml(input.message)}</p>
</td></tr>
</table>
<p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#64748b">If you need to add anything, reply to this email or write to <a href="mailto:${escapeHtml(config.contactEmail)}" style="color:${EMAIL_BRAND.primaryColor};text-decoration:none">${escapeHtml(config.contactEmail)}</a>.</p>`;

  const text = [
    `Hi ${input.name},`,
    '',
    `Thanks for contacting Aegis Loop about ${topic}.`,
    '',
    'Your message:',
    input.message,
    '',
    `We'll reply within one business day. You can also reach us at ${config.contactEmail}.`,
    '',
    `Dashboard: ${dashUrl}`,
  ].join('\n');

  return {
    subject: `We received your message — Aegis Loop`,
    text,
    html: buildEmailShell({
      preheader: `Thanks ${input.name} — we'll reply about ${topic} within one business day.`,
      title: 'Message received',
      headerEyebrow: 'Contact',
      bodyHtml,
      primaryColor: EMAIL_BRAND.primaryColor,
      logoAlt: EMAIL_BRAND.name,
      footerHref: marketingSiteUrl({
        ...UTM.emailFooter,
        content: 'contact-confirm',
      }),
      cta: {
        href: dashUrl,
        label: 'Open Aegis Loop',
      },
    }),
  };
}

export function buildContactTeamEmail(input: ContactFormInput): {
  html: string;
  text: string;
  subject: string;
} {
  const topic = topicLabel(input.topic);
  const bodyHtml = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0">
<tr><td style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:13px;color:#64748b;width:100px">From</td>
<td style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:14px;color:#0f172a"><strong>${escapeHtml(input.name)}</strong> &lt;${escapeHtml(input.email)}&gt;</td></tr>
<tr><td style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:13px;color:#64748b">Topic</td>
<td style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:14px;color:#0f172a">${escapeHtml(topic)}</td></tr>
</table>
<p style="margin:24px 0 8px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b">Message</p>
<p style="margin:0;font-size:15px;line-height:1.6;color:#0f172a;white-space:pre-wrap">${escapeHtml(input.message)}</p>`;

  const text = [
    `Contact form — ${topic}`,
    '',
    `From: ${input.name} <${input.email}>`,
    '',
    input.message,
  ].join('\n');

  return {
    subject: `Aegis Loop contact: ${topic} — ${input.name}`,
    text,
    html: buildEmailShell({
      preheader: `${input.name} (${input.email}) — ${topic}`,
      title: `New ${topic.toLowerCase()} inquiry`,
      headerEyebrow: 'Inbound contact',
      bodyHtml,
      primaryColor: EMAIL_BRAND.primaryColor,
      logoAlt: EMAIL_BRAND.name,
      footerSecondary: `Reply directly to ${input.email}`,
    }),
  };
}
