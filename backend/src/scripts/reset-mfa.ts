// Lost authenticator: removes an account's two-step verification and signs it out everywhere. Out-of-band only —
// never reachable over HTTP. The account sets up a new authenticator at its next sign-in.
//   npm run reset-mfa -w @campushub/backend -- --email admin@college.edu
// Against production: ENV_FILE=none with the production DATABASE_URL and BETTER_AUTH_SECRET in the environment.
import { emailSchema } from '@campushub/shared';
import { pool } from '../db/pool.js';
import { withTransaction } from '../db/transaction.js';
import { resetMfa } from '../modules/mfa/mfa.service.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = emailSchema.safeParse(arg('email') ?? '');
  if (!email.success) {
    console.error('Usage: reset-mfa --email <email>');
    process.exit(1);
  }
  const { rows } = await pool.query<{ id: string; role: string }>('select id, role from public.profiles where lower(email) = $1', [email.data]);
  const user = rows[0];
  if (!user) {
    console.error('No account with that email.');
    process.exit(1);
  }
  const removed = await withTransaction({ actorId: null }, async (tx) => {
    const had = await resetMfa(tx, user.id);
    await tx.query(
      `insert into public.audit_logs (actor_id, action, entity_type, entity_id, summary)
       values (null, 'user.mfa_reset', 'user', $1, $2)`,
      [user.id, `Two-step verification reset for ${email.data} via the reset-mfa script`],
    );
    return had;
  });
  console.log(
    removed
      ? 'Two-step verification removed and all sessions signed out. A new authenticator is set up at the next sign-in.'
      : 'This account had no two-step verification; all sessions were signed out.',
  );
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err?.message ?? err);
    await pool.end();
    process.exit(1);
  });
