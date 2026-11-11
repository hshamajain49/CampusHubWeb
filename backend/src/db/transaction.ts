// withTransaction (§10.5): READ COMMITTED, actor/note settings for history triggers, retries, after-commit hooks.
import type pg from 'pg';
import { pool } from './pool.js';
import { logger } from '../lib/logger.js';

export interface Tx extends pg.PoolClient {
  /** Runs after a successful COMMIT (notification delivery, Cloudinary cleanup). Never delays the response. */
  afterCommit(fn: () => unknown): void;
  /** Changes app.change_note mid-transaction (one transaction touching several bookings). */
  setNote(note: string | null): Promise<void>;
}

export interface TxContext {
  actorId: string | null;
  note?: string | null;
}

const RETRYABLE = new Set(['40P01', '40001']);
const CONNECTION_ERRORS = new Set(['ECONNRESET', '57P01', '08006', '08003', 'ETIMEDOUT', 'ECONNREFUSED']);
const BACKOFF = [50, 150, 400];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withTransaction<T>(ctx: TxContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  let attempt = 0;
  let connectRetried = false;
  for (;;) {
    let client: pg.PoolClient;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
    } catch (err: any) {
      if (!connectRetried && CONNECTION_ERRORS.has(err?.code)) {
        connectRetried = true;
        continue;
      }
      throw err;
    }

    const hooks: (() => unknown)[] = [];
    const tx = client as Tx;
    tx.afterCommit = (cb) => void hooks.push(cb);
    tx.setNote = async (note) => {
      await client.query("select set_config('app.change_note', $1, true)", [note ?? '']);
    };

    let released = false;
    try {
      await client.query("select set_config('app.actor_id', $1, true), set_config('app.change_note', $2, true)", [
        ctx.actorId ?? '',
        ctx.note ?? '',
      ]);
      const result = await fn(tx);
      await client.query('COMMIT');
      client.release();
      released = true;
      for (const cb of hooks) {
        Promise.resolve()
          .then(cb)
          .catch((err) => logger.error({ err }, 'after-commit hook failed'));
      }
      return result;
    } catch (err: any) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* connection already broken */
      }
      if (!released) {
        client.release(CONNECTION_ERRORS.has(err?.code) ? err : undefined);
        released = true;
      }
      if (RETRYABLE.has(err?.code) && attempt < BACKOFF.length) {
        await sleep(BACKOFF[attempt]! + Math.random() * 25);
        attempt++;
        continue;
      }
      throw err;
    }
  }
}
