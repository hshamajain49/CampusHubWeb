// Dev users and sample bookings (§26.6). Uses the account helpers so password hashes are valid.
// Refuses production and non-local databases, except a non-production Neon branch (NEON_BRANCH) or --allow-remote.
//   --if-empty   skip when users already exist (used by `npm run local`); seeds venues from dev.sql when none exist.
import fs from 'node:fs';
import path from 'node:path';
import { addDays } from '@campushub/shared';
import { config } from '../config/env.js';
import { pool } from '../db/pool.js';
import { withTransaction, type Tx } from '../db/transaction.js';
import { createCredentialUser, hashPassword } from '../lib/auth-accounts.js';
import { loadCampus } from '../domain/settings.js';
import { publish } from '../modules/notifications/notifier.js';

const args = new Set(process.argv.slice(2));
const host = new URL(config.DATABASE_URL).hostname;
if (config.NODE_ENV === 'production') {
  console.error('seed-dev refuses to run with NODE_ENV=production');
  process.exit(1);
}
// A Neon branch synced by `npm run neon:env` records its name; any branch but production may be seeded.
const neonDevBranch = !!config.NEON_BRANCH && config.NEON_BRANCH !== 'production';
if (!['localhost', '127.0.0.1', '::1'].includes(host) && !args.has('--allow-remote') && !neonDevBranch) {
  console.error(`seed-dev refuses non-local database ${host} (pass --allow-remote for a Neon dev branch)`);
  process.exit(1);
}

const USERS = [
  { email: 'admin@demo.edu', password: 'Admin12345', name: 'Venue Administrator', role: 'super_admin', department: null },
  { email: 'student@demo.edu', password: 'Student12345', name: 'Priya Sharma', role: 'student', department: 'Computer Science' },
  { email: 'faculty@demo.edu', password: 'Faculty12345', name: 'Daniel Okafor', role: 'faculty_staff', department: 'Physics' },
  { email: 'ananya.iyer@demo.edu', password: 'Student12345', name: 'Ananya Iyer', role: 'student', department: 'Electronics' },
  { email: 'rahul.mehta@demo.edu', password: 'Student12345', name: 'Rahul Mehta', role: 'student', department: 'Mechanical Engineering' },
] as const;

async function ensureVenues() {
  const n = (await pool.query<{ n: number }>('select count(*) as n from public.venues')).rows[0]!.n;
  if (n > 0) return;
  const file = path.resolve(process.cwd(), '..', 'database', 'seed', 'dev.sql');
  const sql = fs.readFileSync(fs.existsSync(file) ? file : path.resolve(process.cwd(), 'database', 'seed', 'dev.sql'), 'utf8');
  await pool.query(sql);
  console.log('[seed] venues and settings from database/seed/dev.sql');
}

async function main() {
  await ensureVenues();
  const existing = (await pool.query<{ n: number }>('select count(*) as n from public.auth_users')).rows[0]!.n;
  if (existing > 0 && args.has('--if-empty')) {
    console.log('[seed] users already exist — skipping');
    return;
  }

  const ids: Record<string, string> = {};
  for (const u of USERS) {
    const found = await pool.query<{ id: string }>('select id from public.profiles where lower(email) = $1', [u.email]);
    if (found.rows[0]) {
      ids[u.email] = found.rows[0].id;
      continue;
    }
    const hash = await hashPassword(u.password);
    ids[u.email] = await withTransaction({ actorId: null }, async (tx) => {
      const id = await createCredentialUser(tx, { email: u.email, name: u.name, passwordHash: hash });
      await tx.query('update public.profiles set role = $2, department = $3 where id = $1', [id, u.role, u.department]);
      return id;
    });
  }
  console.log('[seed] users: admin@demo.edu / Admin12345 · student@demo.edu / Student12345 · faculty@demo.edu / Faculty12345');

  const bookingCount = (await pool.query<{ n: number }>('select count(*) as n from public.bookings')).rows[0]!.n;
  if (bookingCount > 0) return console.log('[seed] bookings already exist — done');

  const venues = Object.fromEntries(
    (await pool.query<{ id: string; name: string }>('select id, name from public.venues')).rows.map((v) => [v.name, v.id]),
  );
  const { today } = await loadCampus(pool);
  const admin = ids['admin@demo.edu']!;
  const student = ids['student@demo.edu']!;
  const faculty = ids['faculty@demo.edu']!;
  const ananya = ids['ananya.iyer@demo.edu']!;
  const rahul = ids['rahul.mehta@demo.edu']!;

  async function book(
    requester: string,
    venue: string,
    day: number,
    start: string,
    end: string,
    purpose: string,
    attendees: number | null,
    then?: (tx: Tx, id: string) => Promise<void>,
  ) {
    await withTransaction({ actorId: requester }, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `insert into public.bookings (venue_id, requester_id, booking_date, start_time, end_time, purpose, expected_attendees)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [venues[venue], requester, addDays(today, day), start, end, purpose, attendees],
      );
      const id = rows[0]!.id;
      if (day >= 0) await publish(tx, { type: 'booking.submitted', bookingId: id, actorId: requester });
      if (then) await then(tx, id);
    });
  }
  const approve = (note: string | null) => async (tx: Tx, id: string) => {
    await tx.query("select set_config('app.actor_id', $1, true), set_config('app.change_note', $2, true)", [admin, note ?? '']);
    await tx.query(`update public.bookings set status = 'approved', decided_by = $2, decided_at = now() where id = $1`, [id, admin]);
    await publish(tx, { type: 'booking.approved', bookingId: id, actorId: admin, data: { note } });
  };
  const reject = (reason: string) => async (tx: Tx, id: string) => {
    await tx.query("select set_config('app.actor_id', $1, true), set_config('app.change_note', $2, true)", [admin, reason]);
    await tx.query(`update public.bookings set status = 'rejected', rejection_reason = $2, decided_by = $3, decided_at = now() where id = $1`, [
      id,
      reason,
      admin,
    ]);
    await publish(tx, { type: 'booking.rejected', bookingId: id, actorId: admin, data: { note: reason } });
  };
  const cancel = (by: string, reason: string) => async (tx: Tx, id: string) => {
    await tx.query("select set_config('app.actor_id', $1, true), set_config('app.change_note', $2, true)", [by, reason]);
    await tx.query(`update public.bookings set status = 'cancelled', cancelled_by = $2, cancelled_at = now(), cancellation_reason = $3 where id = $1`, [
      id,
      by,
      reason,
    ]);
  };

  // Past history
  await book(student, 'Seminar Hall A', -9, '14:00', '16:00', 'Coding club orientation for first-year students', 70, approve(null));
  await book(faculty, 'Conference Room 1', -4, '11:00', '12:00', 'Physics department faculty meeting', 14, approve(null));
  await book(rahul, 'Computer Lab 2', -2, '09:00', '11:00', 'Robotics society workshop: sensors 101', 45, async (tx, id) => {
    await tx.query("update public.bookings set status = 'expired' where id = $1", [id]);
  });
  // Upcoming: 2 approved, 2 pending, 1 rejected, 1 cancelled (+ a few from other members)
  await book(student, 'Seminar Hall A', 3, '10:00', '12:00', 'Department seminar on responsible AI', 90, approve('Please collect the hall keys from the admin office.'));
  await book(faculty, 'Main Auditorium', 6, '15:00', '18:00', 'Guest lecture: frontiers in quantum materials', 420, approve(null));
  await book(student, 'Computer Lab 2', 5, '13:00', '15:00', 'Hackathon prep session for the inter-college round', 50);
  await book(faculty, 'Conference Room 1', 2, '09:30', '10:30', 'PhD progress review with external examiner', 8);
  await book(ananya, 'Open Air Theatre', 9, '17:00', '20:00', 'Cultural fest rehearsal — dance and music teams', 250);
  await book(rahul, 'Indoor Sports Hall', 4, '16:00', '18:00', 'Inter-department badminton qualifiers', 80, approve(null));
  await book(student, 'Main Auditorium', 12, '10:00', '13:00', 'Alumni talk series: building a career in research', 300, reject('The auditorium is reserved for semester examinations that week.'));
  await book(student, 'Seminar Hall A', 8, '14:00', '15:30', 'Study group for the networks mid-term', 25, cancel(student, 'Moved to the library discussion room'));

  // A maintenance block next week on the Main Auditorium
  await pool.query(
    `insert into public.venue_blocks (venue_id, block_type, reason, starts_at, ends_at, created_by)
     values ($1, 'maintenance', 'Sound system replacement', $2::date, ($2::date + 2), $3)`,
    [venues['Main Auditorium'], addDays(today, 14), admin],
  );
  console.log('[seed] bookings, history, a maintenance block and notifications created');
}

main()
  .then(() => new Promise((r) => setTimeout(r, 1500))) // let after-commit notification delivery finish
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('[seed] failed:', err);
    await pool.end();
    process.exit(1);
  });
