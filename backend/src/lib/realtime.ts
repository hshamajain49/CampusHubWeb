// Ably REST client: publish hints and issue token requests (§10.18). Best effort, never fails a request.
import * as Ably from 'ably';
import { config } from '../config/env.js';
import { logger } from './logger.js';

const rest = config.ABLY_API_KEY ? new Ably.Rest({ key: config.ABLY_API_KEY }) : null;
export const realtimeEnabled = !!rest;

export async function publish(channel: string, name: string, data: object): Promise<void> {
  if (!rest) return;
  try {
    await rest.channels.get(channel).publish(name, data);
  } catch (err: any) {
    logger.debug({ err: err?.message, channel, name }, 'realtime publish failed');
  }
}

export async function createTokenRequest(userId: string, isAdmin: boolean) {
  if (!rest) return null;
  const capability: Record<string, string[]> = { [`user:${userId}`]: ['subscribe'] };
  if (isAdmin) capability.admins = ['subscribe'];
  return rest.auth.createTokenRequest({ clientId: userId, ttl: 3_600_000, capability: JSON.stringify(capability) });
}
