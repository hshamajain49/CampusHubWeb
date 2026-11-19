// Dev users and sample bookings (§26.6). Uses the account helpers so password hashes are valid.
// Refuses production and non-local databases, except a non-production Neon branch (NEON_BRANCH) or --allow-remote.
//   --if-empty       skip when users already exist (used by `npm run local`); seeds venues from dev.sql when none exist.
//   --presentation   the same sample data, but accounts on another domain (default example.edu) with passwords
//                    generated now. They are written to backend/.tmp/presentation-accounts.txt (git-ignored) and never
//                    to the repository, so the API's demo-data guard (lib/demo-guard.ts) has nothing to refuse.
//     --domain <d>   email domain for those accounts; --institution "<name>" the institution name to show.
//   --reset --confirm-branch <name>   first DELETES ALL DATA on the target: users, bookings, complaints, suggestions,
//                    notifications, venues, audit log. Settings, departments and categories are kept. <name> must
//                    equal NEON_BRANCH (or "local"), so the wrong database can't be wiped by accident.
import { randomInt } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { addDays } from '@campushub/shared';
import { config } from '../config/env.js';
import { pool } from '../db/pool.js';
import { withTransaction, type Tx } from '../db/transaction.js';
import { createCredentialUser, hashPassword } from '../lib/auth-accounts.js';
import { loadCampus } from '../domain/settings.js';
import { publish } from '../modules/notifications/notifier.js';
import sharp from 'sharp';
import { insertAttachments, preparePhotos } from '../modules/complaints/complaint-photos.js';

const args = new Set(process.argv.slice(2));
const argValue = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
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

type Key = 'admin' | 'student' | 'faculty' | 'ananya' | 'rahul' | 'electrical' | 'plumbing';
interface SeedUser {
  key: Key;
  email: string;
  password: string;
  name: string;
  role: 'super_admin' | 'student' | 'faculty_staff' | 'department_staff';
  department: string | null;
  service?: string;
}
const DEMO_USERS: SeedUser[] = [
  { key: 'admin', email: 'admin@demo.edu', password: 'Admin12345', name: 'Venue Administrator', role: 'super_admin', department: null },
  { key: 'student', email: 'student@demo.edu', password: 'Student12345', name: 'Priya Sharma', role: 'student', department: 'Computer Science' },
  { key: 'faculty', email: 'faculty@demo.edu', password: 'Faculty12345', name: 'Daniel Okafor', role: 'faculty_staff', department: 'Physics' },
  { key: 'ananya', email: 'ananya.iyer@demo.edu', password: 'Student12345', name: 'Ananya Iyer', role: 'student', department: 'Electronics' },
  { key: 'rahul', email: 'rahul.mehta@demo.edu', password: 'Student12345', name: 'Rahul Mehta', role: 'student', department: 'Mechanical Engineering' },
  // Department staff (COMPLAINT_REGISTRATION_SPEC.md §18 "§26.6"): members with a service department.
  { key: 'electrical', email: 'staff.electrical@demo.edu', password: 'Staff12345', name: 'Ravi Kumar', role: 'department_staff', department: null, service: 'Electrical Department' },
  { key: 'plumbing', email: 'staff.plumbing@demo.edu', password: 'Staff12345', name: 'Meera Nair', role: 'department_staff', department: null, service: 'Plumbing Department' },
];

/** 14 characters like "Kx7m-Q2pd-9wLz": letters and digits (no look-alikes), always both; about 70 bits. */
function generatePassword(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  for (;;) {
    const p = [0, 1, 2].map(() => Array.from({ length: 4 }, () => A[randomInt(A.length)]).join('')).join('-');
    if (/[A-Za-z]/.test(p) && /\d/.test(p)) return p;
  }
}

const PRESENTATION = args.has('--presentation');
const DOMAIN = (argValue('domain') ?? 'example.edu').toLowerCase();
if (PRESENTATION && (DOMAIN === 'demo.edu' || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(DOMAIN))) {
  console.error(`--domain must be a domain other than demo.edu (got "${DOMAIN}")`);
  process.exit(1);
}
const USERS: SeedUser[] = PRESENTATION
  ? DEMO_USERS.map((u) => ({ ...u, email: `${u.email.split('@')[0]}@${DOMAIN}`, password: generatePassword() }))
  : DEMO_USERS;

/**
 * Deletes every user and everything they made, plus venues, so the seed starts from an empty database. Settings,
 * service departments and complaint categories (reference data from the migrations) are kept.
 */
async function resetData() {
  const target = config.NEON_BRANCH ?? (['localhost', '127.0.0.1', '::1'].includes(host) ? 'local' : '');
  const confirm = argValue('confirm-branch');
  if (!confirm || confirm !== target) {
    console.error(`--reset deletes all data. Pass --confirm-branch ${target || '<branch>'} to confirm the target (this database: ${host}).`);
    process.exit(1);
  }
  // One server-side block: identifiers are quoted by format('%I'), so no SQL is assembled here.
  //  1. truncate everything except settings, reference data and the users (no CASCADE: nothing kept is hit);
  //  2. kept rows that point at a user (who last edited a setting, created a category...) let go of it;
  //  3. delete the users (profiles follow through their foreign key).
  const { rows } = await pool.query<{ n: number }>(`select count(*)::int as n from pg_tables where schemaname = 'public'`);
  await pool.query(`
    do $$
    declare
      keep constant text[] := array['schema_migrations', 'app_settings', 'service_departments', 'complaint_categories', 'auth_users', 'profiles'];
      tables text;
      r record;
    begin
      select string_agg(format('public.%I', tablename), ', ' order by tablename) into tables
        from pg_tables where schemaname = 'public' and tablename <> all(keep);
      execute 'truncate ' || tables || ' restart identity';
      for r in
        select c.conrelid::regclass as tbl, a.attname as col
          from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
         where c.contype = 'f' and c.confrelid in ('public.profiles'::regclass, 'public.auth_users'::regclass)
           and c.conrelid in ('public.app_settings'::regclass, 'public.service_departments'::regclass, 'public.complaint_categories'::regclass)
      loop
        execute format('update %s set %I = null where %I is not null', r.tbl, r.col, r.col);
      end loop;
      delete from public.auth_users;
      delete from public.profiles;
    end $$`);
  console.log(`[seed] reset: all data deleted on ${target} (${rows[0]!.n - 4} tables); settings, departments and categories kept`);
}

async function ensureVenues() {
  const n = (await pool.query<{ n: number }>('select count(*) as n from public.venues')).rows[0]!.n;
  if (n > 0) return;
  const file = path.resolve(process.cwd(), '..', 'database', 'seed', 'dev.sql');
  const sql = fs.readFileSync(fs.existsSync(file) ? file : path.resolve(process.cwd(), 'database', 'seed', 'dev.sql'), 'utf8');
  await pool.query(sql);
  console.log('[seed] venues and settings from database/seed/dev.sql');
}

async function main() {
  if (args.has('--reset')) await resetData();
  await ensureVenues();
  if (PRESENTATION) {
    const institution = argValue('institution');
    await pool.query(
      `update public.app_settings set support_email = $1${institution ? ', institution_name = $2' : ''} where id = 1`,
      institution ? [`venues@${DOMAIN}`, institution] : [`venues@${DOMAIN}`],
    );
  }
  const existing = (await pool.query<{ n: number }>('select count(*) as n from public.auth_users')).rows[0]!.n;
  if (existing > 0 && args.has('--if-empty')) {
    console.log('[seed] users already exist — skipping');
    return;
  }

  const ids = {} as Record<Key, string>;
  for (const u of USERS) {
    const found = await pool.query<{ id: string }>('select id from public.profiles where lower(email) = $1', [u.email]);
    if (found.rows[0]) {
      ids[u.key] = found.rows[0].id;
      continue;
    }
    const hash = await hashPassword(u.password);
    ids[u.key] = await withTransaction({ actorId: null }, async (tx) => {
      const id = await createCredentialUser(tx, { email: u.email, name: u.name, passwordHash: hash });
      await tx.query(
        `update public.profiles set role = $2, department = $3,
                service_department_id = (select id from public.service_departments where name = $4) where id = $1`,
        [id, u.role, u.department, u.service ?? null],
      );
      return id;
    });
  }
  if (PRESENTATION) {
    // Passwords exist only in this git-ignored file; they are not printed to the terminal.
    const dir = path.resolve(process.cwd(), '.tmp');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'presentation-accounts.txt');
    const roles: Record<SeedUser['role'], string> = { super_admin: 'Super Admin', student: 'Student', faculty_staff: 'Faculty / staff', department_staff: 'Department staff' };
    const lines = USERS.map((u) => `${roles[u.role].padEnd(17)} ${u.name.padEnd(20)} ${u.email.padEnd(34)} ${u.password}${u.service ? `   (${u.service})` : ''}`);
    fs.writeFileSync(file, `CampusHub presentation accounts (${config.NEON_BRANCH ?? host}, created ${new Date().toISOString()})\n\n${lines.join('\n')}\n`, { mode: 0o600 });
    console.log(`[seed] ${USERS.length} accounts on @${DOMAIN}; emails and passwords in ${file}`);
  } else {
    console.log('[seed] users: admin@demo.edu / Admin12345 · student@demo.edu / Student12345 · faculty@demo.edu / Faculty12345');
    console.log('[seed] staff: staff.electrical@demo.edu / Staff12345 · staff.plumbing@demo.edu / Staff12345');
  }
  await seedComplaints(ids);

  const bookingCount = (await pool.query<{ n: number }>('select count(*) as n from public.bookings')).rows[0]!.n;
  if (bookingCount > 0) return console.log('[seed] bookings already exist — done');

  const venues = Object.fromEntries(
    (await pool.query<{ id: string; name: string }>('select id, name from public.venues')).rows.map((v) => [v.name, v.id]),
  );
  const { today } = await loadCampus(pool);
  const { admin, student, faculty, ananya, rahul } = ids;

  /** Inserts like the API: confirmed, or queued behind a confirmed booking; notifications for upcoming ones. */
  async function book(
    requester: string,
    venue: string,
    day: number,
    start: string,
    end: string,
    purpose: string,
    attendees: number | null,
    idNumber: string,
    status: 'confirmed' | 'queued' = 'confirmed',
    then?: (tx: Tx, id: string) => Promise<void>,
  ) {
    await withTransaction({ actorId: requester }, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `insert into public.bookings (venue_id, requester_id, booking_date, start_time, end_time, purpose, expected_attendees, id_number, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
        [venues[venue], requester, addDays(today, day), start, end, purpose, attendees, idNumber, status],
      );
      const id = rows[0]!.id;
      if (day >= 0) {
        await publish(tx, {
          type: status === 'confirmed' ? 'booking.confirmed' : 'booking.queued',
          bookingId: id,
          actorId: requester,
          data: { queuePosition: status === 'queued' ? 1 : null },
        });
      }
      if (then) await then(tx, id);
    });
  }
  const settle = (status: 'completed' | 'expired') => async (tx: Tx, id: string) => {
    await tx.query("select set_config('app.actor_id', '', true)");
    await tx.query('update public.bookings set status = $2 where id = $1', [id, status]);
  };
  const cancel = (by: string, reason: string) => async (tx: Tx, id: string) => {
    await tx.query("select set_config('app.actor_id', $1, true), set_config('app.change_note', $2, true)", [by, reason]);
    await tx.query(`update public.bookings set status = 'cancelled', cancelled_by = $2, cancelled_at = now(), cancellation_reason = $3 where id = $1`, [
      id,
      by,
      reason,
    ]);
  };

  const USN = { student: '1RV22CS045', faculty: 'FAC-1024', ananya: '1RV22EC017', rahul: '1RV21ME032' };
  // Past history
  await book(student, 'Seminar Hall A', -9, '14:00', '16:00', 'Coding club orientation for first-year students', 70, USN.student, 'confirmed', settle('completed'));
  await book(faculty, 'Conference Room 1', -4, '11:00', '12:00', 'Physics department faculty meeting', 14, USN.faculty, 'confirmed', settle('completed'));
  await book(rahul, 'Computer Lab 2', -2, '09:00', '11:00', 'Robotics society workshop: sensors 101', 45, USN.rahul, 'queued', settle('expired'));
  // Upcoming: confirmed bookings, one queued request behind a confirmed one, one cancelled (+ a few from other members)
  await book(student, 'Seminar Hall A', 3, '10:00', '12:00', 'Department seminar on responsible AI', 90, USN.student);
  await book(ananya, 'Seminar Hall A', 3, '10:30', '11:30', 'Debate society practice round', 30, USN.ananya, 'queued');
  await book(faculty, 'Main Auditorium', 6, '15:00', '18:00', 'Guest lecture: frontiers in quantum materials', 420, USN.faculty);
  await book(student, 'Computer Lab 2', 5, '13:00', '15:00', 'Hackathon prep session for the inter-college round', 50, USN.student);
  await book(faculty, 'Conference Room 1', 2, '09:30', '10:30', 'PhD progress review with external examiner', 8, USN.faculty);
  await book(ananya, 'Open Air Theatre', 9, '17:00', '20:00', 'Cultural fest rehearsal — dance and music teams', 250, USN.ananya);
  await book(rahul, 'Indoor Sports Hall', 4, '16:00', '18:00', 'Inter-department badminton qualifiers', 80, USN.rahul);
  await book(student, 'Seminar Hall A', 8, '14:00', '15:30', 'Study group for the networks mid-term', 25, USN.student, 'confirmed', cancel(student, 'Moved to the library discussion room'));

  // A three-day workshop: one multi-day booking (the same morning window every day).
  await withTransaction({ actorId: faculty }, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `insert into public.bookings (venue_id, requester_id, booking_date, end_date, start_time, end_time, purpose, expected_attendees, id_number, status)
       values ($1, $2, $3, $4, '09:00', '13:00', $5, 40, $6, 'confirmed') returning id`,
      [venues['Computer Lab 2'], faculty, addDays(today, 15), addDays(today, 17), 'Three-day data science workshop for faculty', USN.faculty],
    );
    await publish(tx, { type: 'booking.confirmed', bookingId: rows[0]!.id, actorId: faculty });
  });

  // Suggestion box: one new, one already answered.
  await pool.query(
    `insert into public.suggestions (author_id, subject, message, status, admin_response, reviewed_by, reviewed_at) values
       ($1, 'Longer library hours during exams', 'Could the reading room stay open until 22:00 in the two weeks before semester exams?', 'new', null, null, null),
       ($2, 'Projector remote in Seminar Hall A', 'The projector remote in Seminar Hall A is often missing. A wall-mounted holder would help.', 'reviewed',
        'Thanks! A holder has been ordered and will be fitted next week.', $3, now())`,
    [student, ananya, admin],
  );

  // A maintenance block next week on the Main Auditorium
  await pool.query(
    `insert into public.venue_blocks (venue_id, block_type, reason, starts_at, ends_at, created_by)
     values ($1, 'maintenance', 'Sound system replacement', $2::date, ($2::date + 2), $3)`,
    [venues['Main Auditorium'], addDays(today, 14), admin],
  );
  console.log('[seed] bookings, history, a maintenance block and notifications created');
}

/** A solid-colour placeholder photo, processed through the real pipeline (WebP, private store). */
const placeholder = (color: string) =>
  sharp({ create: { width: 1200, height: 900, channels: 3, background: color } }).jpeg({ quality: 80 }).toBuffer();

/** Sample complaints across every status (§18 "§26.6"). Skipped when complaints already exist. */
async function seedComplaints(ids: Record<Key, string>) {
  const existing = (await pool.query<{ n: number }>('select count(*) as n from public.complaints')).rows[0]!.n;
  if (existing > 0) return console.log('[seed] complaints already exist — skipping');
  const cat = Object.fromEntries(
    (await pool.query<{ slug: string; id: string; department_id: string }>('select slug, id, department_id from public.complaint_categories')).rows.map(
      (c) => [c.slug, c],
    ),
  );
  const venue = Object.fromEntries((await pool.query<{ id: string; name: string }>('select id, name from public.venues')).rows.map((v) => [v.name, v.id]));
  const { student, faculty, ananya, rahul, admin } = ids;
  const electrician = ids.electrical;
  const plumber = ids.plumbing;
  const act = (tx: Tx, actor: string | null, note: string | null = null) =>
    tx.query("select set_config('app.actor_id', $1, true), set_config('app.change_note', $2, true)", [actor ?? '', note ?? '']);

  async function file(
    reporter: string,
    slug: string,
    title: string,
    opts: { venue?: string; location?: string; description?: string; photos?: string[]; daysAgo: number },
    then?: (tx: Tx, id: string) => Promise<void>,
  ) {
    const { rows } = await pool.query<{ id: string }>('select gen_random_uuid() as id');
    const id = rows[0]!.id;
    const files = await Promise.all((opts.photos ?? []).map(async (c, i) => ({ buffer: await placeholder(c), name: `photo-${i + 1}.jpg` })));
    const prepared = await preparePhotos(id, files);
    await withTransaction({ actorId: reporter }, async (tx) => {
      await tx.query(
        `insert into public.complaints (id, reporter_id, category_id, department_id, venue_id, location_details, title, description, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, now() - make_interval(days => $9))`,
        [id, reporter, cat[slug]!.id, cat[slug]!.department_id, opts.venue ? venue[opts.venue] : null, opts.location ?? null, title, opts.description ?? null, opts.daysAgo],
      );
      await tx.query('update public.complaint_history set created_at = now() - make_interval(days => $2) where complaint_id = $1', [id, opts.daysAgo]);
      await insertAttachments(tx, id, 'report', prepared, reporter);
      if (then) await then(tx, id);
    });
  }
  const start = (staff: string, note: string | null = null) => async (tx: Tx, id: string) => {
    await act(tx, staff, note);
    await tx.query(`update public.complaints set status = 'in_progress', handled_by = $2 where id = $1`, [id, staff]);
  };
  const done = (staff: string, note: string) => async (tx: Tx, id: string) => {
    await start(staff)(tx, id);
    await act(tx, staff, note);
    await tx.query(`update public.complaints set status = 'awaiting_confirmation', resolution_note = $2 where id = $1`, [id, note]);
  };

  await file(student, 'electrical', 'Fan not working in Room 204', {
    location: 'Block A, Room 204',
    description: 'The ceiling fan near the window stopped working this morning. The regulator turns but nothing happens.',
    photos: ['#C9D5F2', '#F1DEA3'],
    daysAgo: 1,
  });
  await file(faculty, 'plumbing', 'Leaking tap in the staff washroom', { location: 'Science Block, 1st floor', photos: ['#BFE5D1'], daysAgo: 3 }, start(plumber, 'Will replace the washer this afternoon.'));
  await file(
    student,
    'electrical',
    'Projector flickers during presentations',
    { venue: 'Seminar Hall A', description: 'The image flickers every few seconds, especially on dark slides.', photos: ['#E8EDFA'], daysAgo: 4 },
    async (tx, id) => {
      await done(electrician, 'Replaced the HDMI cable and reseated the lamp.')(tx, id);
    },
  );
  await file(ananya, 'it_network', 'No Wi-Fi in Computer Lab 2', { venue: 'Computer Lab 2', daysAgo: 9 }, async (tx, id) => {
    await act(tx, admin, 'Router restarted.');
    await tx.query(`update public.complaints set status = 'in_progress', handled_by = $2 where id = $1`, [id, admin]);
    await act(tx, admin, 'Router replaced; signal is strong across the lab.');
    await tx.query(`update public.complaints set status = 'awaiting_confirmation', resolution_note = 'Router replaced; signal is strong across the lab.' where id = $1`, [id]);
    await act(tx, ananya);
    await tx.query(`update public.complaints set status = 'resolved' where id = $1`, [id]);
  });
  await file(rahul, 'electrical', 'Tube light flickering in the corridor', { location: 'Mechanical Block, ground floor corridor', daysAgo: 10 }, async (tx, id) => {
    await done(electrician, 'Replaced the starter.')(tx, id);
    await act(tx, rahul, 'It still flickers in the evening.');
    await tx.query(`update public.complaints set status = 'in_progress', rejection_reason = 'It still flickers in the evening.' where id = $1`, [id]);
  });
  await file(student, 'cleanliness', 'Washrooms on the 2nd floor need cleaning', { location: 'Library, 2nd floor', daysAgo: 6 }, async (tx, id) => {
    await act(tx, student, 'Filed by mistake — already cleaned.');
    await tx.query(`update public.complaints set status = 'withdrawn', closure_reason = 'Filed by mistake — already cleaned.' where id = $1`, [id]);
  });
  await file(faculty, 'electrical', 'Water dripping from the ceiling near a switchboard', { location: 'Physics Lab 3', photos: ['#FCE8E8'], daysAgo: 2 }, async (tx, id) => {
    await act(tx, electrician, 'This is a pipe leak above the false ceiling, not an electrical fault.');
    await tx.query(
      `update public.complaints set reassignment_requested = true, reassignment_note = 'This is a pipe leak above the false ceiling, not an electrical fault.',
              reassignment_suggested_category_id = $2 where id = $1`,
      [id, cat.plumbing!.id],
    );
  });
  console.log('[seed] 7 sample complaints across every status (with placeholder photos)');
}

main()
  .then(() => new Promise((r) => setTimeout(r, 1500))) // let after-commit notification delivery finish
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('[seed] failed:', err);
    await pool.end();
    process.exit(1);
  });
