// Super Admin provisioning, §14.9 Method A. Out-of-band only — never reachable over HTTP.
//   npm run create-super-admin -w @campushub/backend -- --email admin@college.edu --name "Venue Administrator" [--password-stdin]
import { randomInt } from 'node:crypto';
import { domainAllowed, emailSchema, fullNameSchema, passwordSchema } from '@campushub/shared';
import { pool } from '../db/pool.js';
import { withTransaction } from '../db/transaction.js';
import { createCredentialUser, hashPassword } from '../lib/auth-accounts.js';
import { loadCampus } from '../domain/settings.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function generatePassword(): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%^&*-_=+'];
  const all = sets.join('');
  const chars = sets.map((s) => s[randomInt(s.length)]!);
  while (chars.length < 16) chars.push(all[randomInt(all.length)]!);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function main() {
  const email = emailSchema.safeParse(arg('email') ?? '');
  const name = fullNameSchema.safeParse(arg('name') ?? '');
  if (!email.success || !name.success) {
    console.error('Usage: create-super-admin --email <email> --name "<Full Name>" [--password-stdin]');
    process.exit(1);
  }
  const { settings } = await loadCampus(pool);
  if (!domainAllowed(email.data, settings.allowedEmailDomains)) {
    console.error(`The email domain is not in allowed_email_domains (${settings.allowedEmailDomains.join(', ')}).`);
    process.exit(1);
  }

  const existing = await pool.query<{ id: string }>('select id from public.profiles where lower(email) = $1', [email.data]);
  if (existing.rows[0]) {
    await withTransaction({ actorId: null }, async (tx) => {
      await tx.query("update public.profiles set role = 'super_admin', is_active = true where id = $1", [existing.rows[0]!.id]);
      await tx.query(
        `insert into public.audit_logs (actor_id, action, entity_type, entity_id, summary)
         values (null, 'user.super_admin_provisioned', 'user', $1, $2)`,
        [existing.rows[0]!.id, `Super Admin role granted to ${email.data} via provisioning script`],
      );
    });
    console.log('Existing user promoted to Super Admin.');
    return;
  }

  const password = process.argv.includes('--password-stdin') ? await readStdin() : generatePassword();
  if (!passwordSchema.safeParse(password).success) {
    console.error('The password must be 8–72 characters and include a letter and a number.');
    process.exit(1);
  }
  const hash = await hashPassword(password);
  await withTransaction({ actorId: null }, async (tx) => {
    const id = await createCredentialUser(tx, { email: email.data, name: name.data, passwordHash: hash });
    await tx.query("update public.profiles set role = 'super_admin', is_active = true, must_change_password = true where id = $1", [id]);
    await tx.query(
      `insert into public.audit_logs (actor_id, action, entity_type, entity_id, summary)
       values (null, 'user.super_admin_provisioned', 'user', $1, $2)`,
      [id, `Super Admin account ${email.data} created via provisioning script`],
    );
  });
  // Printed once to the terminal; never logged.
  process.stdout.write(`\nSuper Admin created.\n  Email:    ${email.data}\n  Password: ${password}\nThey will be asked to choose a new password at first sign-in.\n\n`);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err?.message ?? err);
    await pool.end();
    process.exit(1);
  });
