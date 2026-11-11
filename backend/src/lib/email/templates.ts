// Email templates (§10.18): inline CSS only, no images, no tracking links, every value HTML-escaped.
import { config } from '../../config/env.js';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  links: string[];
}

interface LayoutInput {
  institutionName: string;
  title: string;
  body: string;
  buttonLabel: string;
  url: string;
  footer: boolean;
  extra?: string;
}

function layout(i: LayoutInput): { html: string; text: string } {
  const footer = i.footer
    ? `You're receiving this because you have a CampusHub Venue Booking account. Manage email preferences: ${config.FRONTEND_URL}/profile`
    : '';
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#F4F6FB;font-family:Inter,Segoe UI,Arial,sans-serif;color:#141B2D">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6FB;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #E4E8F1;border-radius:14px">
<tr><td style="padding:20px 28px;border-bottom:1px solid #E4E8F1;font-weight:700;font-size:14px;color:#1E3A8A;letter-spacing:.2px">${escapeHtml(i.institutionName)} · CampusHub Venue Booking</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 12px;font-size:20px;line-height:28px;font-weight:600;color:#141B2D">${escapeHtml(i.title)}</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:23px;color:#141B2D">${escapeHtml(i.body)}</p>
${i.extra ? `<p style="margin:0 0 24px;font-size:13px;line-height:20px;color:#5E6A82">${escapeHtml(i.extra)}</p>` : ''}
<a href="${escapeHtml(i.url)}" style="display:inline-block;background:#1E3A8A;color:#FFFFFF;text-decoration:none;font-weight:600;font-size:14px;padding:12px 20px;border-radius:10px">${escapeHtml(i.buttonLabel)}</a>
<p style="margin:20px 0 0;font-size:12px;line-height:18px;color:#5E6A82;word-break:break-all">${escapeHtml(i.url)}</p>
</td></tr>
${footer ? `<tr><td style="padding:16px 28px;border-top:1px solid #E4E8F1;font-size:12px;line-height:18px;color:#5E6A82">${escapeHtml(footer)}</td></tr>` : ''}
</table></td></tr></table></body></html>`;
  const text = [i.title, '', i.body, ...(i.extra ? ['', i.extra] : []), '', `${i.buttonLabel}: ${i.url}`, ...(footer ? ['', footer] : [])].join('\n');
  return { html, text };
}

export function renderPasswordReset(institutionName: string, url: string): RenderedEmail {
  const { html, text } = layout({
    institutionName,
    title: 'Reset your password',
    body: 'Someone asked to reset the password for your CampusHub Venue Booking account. Use the button below to choose a new password.',
    extra: "This link works once and expires in 1 hour. If you didn't ask for it, ignore this email.",
    buttonLabel: 'Reset password',
    url,
    footer: false,
  });
  return { subject: 'Reset your CampusHub password', html, text, links: [url] };
}

export interface NotificationEmailInput {
  institutionName: string;
  type: string;
  title: string;
  body: string;
  url: string;
  venue: string;
  dayMonth: string;
  time: string;
  relativeDay: string;
  reference: string;
  requester: string;
}

export function renderNotificationEmail(i: NotificationEmailInput): RenderedEmail {
  const subjects: Record<string, string> = {
    booking_approved: `Approved: ${i.venue} on ${i.dayMonth}`,
    booking_rejected: `Not approved: ${i.venue} on ${i.dayMonth}`,
    booking_cancelled: `Cancelled: ${i.venue} on ${i.dayMonth}`,
    booking_expired: `Expired request: ${i.venue} on ${i.dayMonth}`,
    booking_reminder: `Reminder: ${i.venue} at ${i.time} ${i.relativeDay}`,
    admin_new_request: `New request: ${i.venue} on ${i.dayMonth} (${i.requester})`,
    admin_request_modified: `Re-approval needed: ${i.reference}`,
    admin_booking_cancelled: `Cancelled by requester: ${i.reference}`,
  };
  const { html, text } = layout({
    institutionName: i.institutionName,
    title: i.title,
    body: i.body,
    buttonLabel: 'View booking',
    url: i.url,
    footer: true,
  });
  return { subject: subjects[i.type] ?? i.title, html, text, links: [i.url] };
}
