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
import sharp from 'sharp';
import { insertAttachments, preparePhotos } from '../modules/complaints/complaint-photos.js';

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
  // Department staff (COMPLAINT_REGISTRATION_SPEC.md §18 "§26.6"): members with a service department.
  { email: 'staff.electrical@demo.edu', password: 'Staff12345', name: 'Ravi Kumar', role: 'department_staff', department: null, service: 'Electrical Department' },
  { email: 'staff.plumbing@demo.edu', password: 'Staff12345', name: 'Meera Nair', role: 'department_staff', department: null, service: 'Plumbing Department' },
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
      await tx.query(
        `update public.profiles set role = $2, department = $3,
                service_department_id = (select id from public.service_departments where name = $4) where id = $1`,
        [id, u.role, u.department, 'service' in u ? u.service : null],
      );
      return id;
    });
  }
  console.log('[seed] users: admin@demo.edu / Admin12345 · student@demo.edu / Student12345 · faculty@demo.edu / Faculty12345');
  console.log('[seed] staff: staff.electrical@demo.edu / Staff12345 · staff.plumbing@demo.edu / Staff12345');
  await seedComplaints(ids);

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

/** A solid-colour placeholder photo, processed through the real pipeline (WebP, private store). */
const placeholder = (color: string) =>
  sharp({ create: { width: 1200, height: 900, channels: 3, background: color } }).jpeg({ quality: 80 }).toBuffer();

/** Sample complaints across every status (§18 "§26.6"). Skipped when complaints already exist. */
async function seedComplaints(ids: Record<string, string>) {
  const existing = (await pool.query<{ n: number }>('select count(*) as n from public.complaints')).rows[0]!.n;
  if (existing > 0) return console.log('[seed] complaints already exist — skipping');
  const cat = Object.fromEntries(
    (await pool.query<{ slug: string; id: string; department_id: string }>('select slug, id, department_id from public.complaint_categories')).rows.map(
      (c) => [c.slug, c],
    ),
  );
  const venue = Object.fromEntries((await pool.query<{ id: string; name: string }>('select id, name from public.venues')).rows.map((v) => [v.name, v.id]));
  const [student, faculty, ananya, rahul, admin] = ['student@demo.edu', 'faculty@demo.edu', 'ananya.iyer@demo.edu', 'rahul.mehta@demo.edu', 'admin@demo.edu'].map(
    (e) => ids[e]!,
  ) as [string, string, string, string, string];
  const electrician = ids['staff.electrical@demo.edu']!;
  const plumber = ids['staff.plumbing@demo.edu']!;
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
