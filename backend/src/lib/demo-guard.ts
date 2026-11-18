// Production start-up guard (security/AUDIT.md F-01, F-05). The dev seed creates @demo.edu accounts whose passwords
// are published in this public repository; a production API reading that database hands anyone a Super Admin
// sign-in. Refuse to start instead, unless ALLOW_DEMO_DATA=true says the demo is deliberate.
import type { DbClient } from '../db/pool.js';

export const DEMO_EMAIL_DOMAIN = 'demo.edu';

export type DemoGuardResult =
  | { action: 'skip'; reason: 'not production' | 'allowed by ALLOW_DEMO_DATA' }
  | { action: 'start'; demoAccounts: 0 }
  | { action: 'refuse'; demoAccounts: number }
  | { action: 'unchecked'; error: string };

export async function checkDemoData(db: DbClient, opts: { nodeEnv: string; allowDemoData: boolean }): Promise<DemoGuardResult> {
  if (opts.nodeEnv !== 'production') return { action: 'skip', reason: 'not production' };
  if (opts.allowDemoData) return { action: 'skip', reason: 'allowed by ALLOW_DEMO_DATA' };
  try {
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.profiles where lower(email) like '%@' || $1",
      [DEMO_EMAIL_DOMAIN],
    );
    const n = rows[0]?.n ?? 0;
    return n > 0 ? { action: 'refuse', demoAccounts: n } : { action: 'start', demoAccounts: 0 };
  } catch (err: any) {
    // An unreachable database is not proof of demo data; the API starts and its readiness check reports the outage.
    return { action: 'unchecked', error: err?.message ?? String(err) };
  }
}
