// Web Push helpers (§9.15). Loaded lazily after sign-in.
import { apiFetch } from './api-client';

export type PushState = 'unsupported' | 'unconfigured' | 'ios-install' | 'denied' | 'off' | 'on';

export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration() {
  return navigator.serviceWorker.ready;
}

export async function pushState(publicKey: string | null): Promise<PushState> {
  if (!publicKey) return 'unconfigured';
  if (isIos() && !isStandalone() && !pushSupported()) return 'ios-install';
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const sub = await (await registration()).pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

export async function enablePush(publicKey: string): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const reg = await registration();
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  await apiFetch('/me/push-subscriptions', { method: 'POST', body: sub.toJSON() });
  return 'on';
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const sub = await (await registration()).pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => undefined);
  await apiFetch('/me/push-subscriptions', { method: 'DELETE', body: { endpoint } }).catch(() => undefined);
}

/** Re-sends an existing subscription once per session so a shared device is rebound to the current user. */
export async function resyncPush(publicKey: string | null): Promise<void> {
  if (!publicKey || !pushSupported() || sessionStorage.getItem('push.synced')) return;
  const sub = await (await registration()).pushManager.getSubscription();
  if (sub) await apiFetch('/me/push-subscriptions', { method: 'POST', body: sub.toJSON() }).catch(() => undefined);
  sessionStorage.setItem('push.synced', '1');
}
