// Web Push with VAPID (§10.18). Disabled when any VAPID variable is missing.
import webpush from 'web-push';
import { config, integrations } from '../config/env.js';

export const pushEnabled = integrations.push === 'configured';
if (pushEnabled) webpush.setVapidDetails(config.VAPID_SUBJECT!, config.VAPID_PUBLIC_KEY!, config.VAPID_PRIVATE_KEY!);

export interface PushSender {
  send(sub: { endpoint: string; p256dh: string; auth_secret: string }, payload: object, urgency: 'normal' | 'high'): Promise<{ ok: boolean; gone: boolean }>;
}

export const pushSender: PushSender = {
  async send(sub, payload, urgency) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_secret } },
        JSON.stringify(payload),
        { TTL: 86_400, urgency, timeout: 10_000 },
      );
      return { ok: true, gone: false };
    } catch (err: any) {
      return { ok: false, gone: err?.statusCode === 404 || err?.statusCode === 410 };
    }
  },
};
