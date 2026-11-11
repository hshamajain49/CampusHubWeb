// Email service (§10.18): Brevo HTTPS API, file outbox (tests/e2e), or console. Every attempt is logged in email_log.
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../config/env.js';
import { pool } from '../../db/pool.js';
import { logger } from '../logger.js';
import { renderPasswordReset } from './templates.js';

export interface EmailMessage {
  kind: 'auth' | 'notification';
  template: string;
  recipientId: string | null;
  notificationId?: string | null;
  to: { email: string; name: string };
  subject: string;
  html: string;
  text: string;
  links?: string[];
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export const emailConfigured = () => true; // console/file transports always "deliver" locally

async function transportSend(msg: EmailMessage): Promise<SendResult> {
  if (config.EMAIL_TRANSPORT === 'brevo') {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': config.BREVO_API_KEY!, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: config.EMAIL_FROM_NAME, email: config.EMAIL_FROM_ADDRESS },
        to: [{ email: msg.to.email, name: msg.to.name }],
        ...(config.EMAIL_REPLY_TO ? { replyTo: { email: config.EMAIL_REPLY_TO } } : {}),
        subject: msg.subject,
        htmlContent: msg.html,
        textContent: msg.text,
        tags: [msg.template],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 201 || res.ok) {
      const body = (await res.json().catch(() => ({}))) as { messageId?: string };
      return { ok: true, messageId: body.messageId };
    }
    return { ok: false, error: `Brevo ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}` };
  }
  if (config.EMAIL_TRANSPORT === 'file') {
    const dir = path.resolve(process.cwd(), config.EMAIL_OUTBOX_DIR);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${msg.template}.json`);
    await fs.writeFile(file, JSON.stringify({ to: msg.to, subject: msg.subject, html: msg.html, text: msg.text, links: msg.links ?? [] }, null, 2));
    return { ok: true, messageId: path.basename(file) };
  }
  logger.info({ to: msg.to.email, subject: msg.subject, links: msg.links }, 'email (console transport)');
  return { ok: true, messageId: 'console' };
}

export async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  let result: SendResult;
  try {
    result = await transportSend(msg);
  } catch (err: any) {
    result = { ok: false, error: String(err?.message ?? err).slice(0, 300) };
  }
  await pool
    .query(
      `insert into public.email_log (kind, template, recipient_id, notification_id, status, provider_message_id, error)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [msg.kind, msg.template, msg.recipientId, msg.notificationId ?? null, result.ok ? 'sent' : 'failed', result.messageId ?? null, result.error ?? null],
    )
    .catch((err) => logger.warn({ err }, 'email_log insert failed'));
  if (!result.ok) logger.warn({ template: msg.template, error: result.error }, 'email send failed');
  return result;
}

export async function logSkippedEmail(template: string, recipientId: string, notificationId: string, status: 'skipped_quota' | 'skipped_disabled') {
  await pool.query(
    'insert into public.email_log (kind, template, recipient_id, notification_id, status) values ($1, $2, $3, $4, $5)',
    ['notification', template, recipientId, notificationId, status],
  );
}

/** Auth emails bypass the notification budget and master switch (§10.18) but are still logged. */
export async function sendPasswordResetEmail(userId: string, url: string): Promise<void> {
  const { rows } = await pool.query<{ email: string; full_name: string; is_active: boolean; institution_name: string }>(
    `select p.email, p.full_name, p.is_active, s.institution_name
       from public.profiles p cross join public.app_settings s where p.id = $1 and s.id = 1`,
    [userId],
  );
  const p = rows[0];
  if (!p || !p.is_active) return; // inactive accounts receive nothing; the API response stays neutral
  const rendered = renderPasswordReset(p.institution_name, url);
  await sendEmail({ kind: 'auth', template: 'password_reset', recipientId: userId, to: { email: p.email, name: p.full_name }, ...rendered });
}
