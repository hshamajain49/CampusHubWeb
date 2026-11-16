// Client change batch: multi-day bookings, cancellation details + announcements to every member, Super Admin booking,
// suggestion box, permanent account deletion (docs/BOOKINGS.md, docs/ACCOUNTS.md).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, campusDate, closePools, createVenue, member, resetDb, signIn, slot, staffMember } from '../helpers/app.js';
import { pool } from '../helpers/db.js';

type User = { id: string; token: string };
let stu: User, other: User, third: User, admin: User;
let venueId: string;
let day: string;

const notesOf = async (userId: string, type: string) =>
  (await pool.query('select title, body, link_path from notifications where recipient_id = $1 and type = $2 order by created_at', [userId, type])).rows;

/** Announcements to every member are written after commit: poll briefly. */
async function eventually<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeAll(async () => {
  await resetDb();
  stu = await member('priya@chg.edu');
  other = await member('daniel@chg.edu', 'faculty_staff');
  third = await member('ananya@chg.edu');
  admin = await member('admin@chg.edu', 'super_admin');
  venueId = await createVenue('Change Hall');
  day = await campusDate(10);
});
afterAll(closePools);

describe('multi-day bookings', () => {
  it('books the same window on consecutive days; one clashing day queues the whole request', async () => {
    const end = await campusDate(12);
    const res = await as(stu.token).post('/bookings', { ...slot(venueId, day, '09:00', '11:00', 'Three-day workshop'), endDate: end });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'confirmed', date: day, endDate: end, days: 3, startTime: '09:00', endTime: '11:00' });
    expect(res.body.data.end).toBe(`${end}T11:00:00`);

    // Only the last day clashes → queued.
    const clash = await as(other.token).post('/bookings', { ...slot(venueId, end, '10:00', '12:00', 'Overlaps day 3', 'FAC-1024'), endDate: await campusDate(13) });
    expect(clash.body.data).toMatchObject({ status: 'queued', queuePosition: 1, days: 2 });
    // Same days, afternoon → free.
    const afternoon = await as(third.token).post('/bookings', { ...slot(venueId, day, '13:00', '15:00', 'Afternoon', '1RV22EC017'), endDate: end });
    expect(afternoon.body.data.status).toBe('confirmed');

    // Availability shows one block per day; the check predicts the queue for any clashing day.
    const avail = (await as(third.token).get(`/venues/${venueId}/availability?from=${day}&to=${end}`)).body.data.intervals;
    expect(avail.filter((i: { start: string }) => i.start.endsWith('09:00:00'))).toHaveLength(3);
    const check = (await as(third.token).get(`/venues/${venueId}/availability/check?date=${day}&endDate=${end}&startTime=10:00&endTime=10:30`)).body.data;
    expect(check).toMatchObject({ outcome: 'queue' });
  });

  it('refuses an end date before the start or more than 14 days', async () => {
    const before = await as(stu.token).post('/bookings', { ...slot(venueId, await campusDate(20), '16:00', '17:00'), endDate: await campusDate(19) });
    expect(before.status).toBe(400);
    const tooLong = await as(stu.token).post('/bookings', { ...slot(venueId, await campusDate(20), '16:00', '17:00'), endDate: await campusDate(34) });
    expect([tooLong.status, tooLong.body.error.code]).toEqual([422, 'TOO_MANY_DAYS']);
  });
});

describe('cancellation details and announcements', () => {
  it('announces a new booking to every member except the booker and admins', async () => {
    const d = await campusDate(21);
    const b = (await as(stu.token).post('/bookings', slot(venueId, d, '08:00', '09:00', 'Announced'))).body.data;
    const others = await eventually(
      () => pool.query("select recipient_id, link_path from notifications where booking_id = $1 and type = 'venue_booked'", [b.id]),
      (r) => r.rowCount! >= 2,
    );
    const ids = others.rows.map((r) => r.recipient_id);
    expect(ids).toEqual(expect.arrayContaining([other.id, third.id]));
    expect(ids).not.toContain(stu.id);
    expect(ids).not.toContain(admin.id);
    expect(others.rows[0].link_path).toBe(`/venues/${venueId}`);
  });

  it('the member who cancels sees venue, status and availability; everyone hears the time is free again', async () => {
    const d = await campusDate(22);
    const b = (await as(stu.token).post('/bookings', slot(venueId, d, '08:00', '09:00', 'To cancel'))).body.data;
    const res = await as(stu.token).post(`/bookings/${b.id}/cancel`, { reason: 'Plans changed' });
    expect(res.status).toBe(200);
    const [mine] = (await notesOf(stu.id, 'booking_cancelled')).filter((n) => n.body.includes(b.reference));
    expect(mine.title).toBe('Booking cancelled');
    expect(mine.body).toContain('Change Hall');
    expect(mine.body).toContain('Status: Cancelled.');
    expect(mine.body).toContain('The time is available again: anyone can book it.');
    expect(mine.body).toContain('Reason: Plans changed');
    const free = await eventually(
      () => pool.query("select recipient_id from notifications where booking_id = $1 and type = 'venue_available'", [b.id]),
      (r) => r.rowCount! >= 2,
    );
    expect(free.rows.map((r) => r.recipient_id)).toEqual(expect.arrayContaining([other.id, third.id]));
  });

  it('when someone was queued, the canceller hears the time went to the queue and nobody hears it is free', async () => {
    const d = await campusDate(23);
    const holder = (await as(stu.token).post('/bookings', slot(venueId, d, '08:00', '09:00', 'Holder'))).body.data;
    await as(other.token).post('/bookings', slot(venueId, d, '08:00', '09:00', 'Waiting', 'FAC-1024'));
    await as(stu.token).post(`/bookings/${holder.id}/cancel`, {});
    const [mine] = (await notesOf(stu.id, 'booking_cancelled')).filter((n) => n.body.includes(holder.reference));
    expect(mine.body).toContain('The time went to the next person in the queue.');
    await new Promise((r) => setTimeout(r, 300));
    expect((await pool.query("select 1 from notifications where booking_id = $1 and type = 'venue_available'", [holder.id])).rowCount).toBe(0);
  });
});

describe('Super Admin bookings', () => {
  it('books, sees and cancels their own bookings through the member endpoints, linked to the admin area', async () => {
    const b = await as(admin.token).post('/bookings', slot(venueId, await campusDate(24), '08:00', '09:00', 'Senate meeting', 'ADM-0001'));
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    expect(b.body.data.status).toBe('confirmed');
    expect((await as(admin.token).get('/bookings?scope=upcoming')).body.data.map((x: { id: string }) => x.id)).toContain(b.body.data.id);
    const [note] = await notesOf(admin.id, 'booking_confirmed');
    expect(note.link_path).toBe(`/admin/my-bookings/${b.body.data.id}`);
    expect((await as(admin.token).post(`/bookings/${b.body.data.id}/cancel`, {})).body.data.status).toBe('cancelled');
  });
});

describe('suggestion box', () => {
  it('members send suggestions; the admin lists, replies and marks them reviewed; the author sees the reply', async () => {
    const bad = await as(stu.token).post('/suggestions', { subject: 'Hi', message: 'short' });
    expect(bad.status).toBe(400);
    const s = await as(stu.token).post('/suggestions', { subject: 'More power sockets', message: 'Seminar Hall A needs more power sockets near the seats.' });
    expect(s.status).toBe(201);
    expect(s.body.data).toMatchObject({ status: 'new', adminResponse: null });
    expect((await as(other.token).get('/suggestions')).body.data).toHaveLength(0); // only your own
    expect((await as(stu.token).get('/admin/suggestions')).status).toBe(403);

    const list = await as(admin.token).get('/admin/suggestions?status=new');
    expect(list.body.data[0]).toMatchObject({ subject: 'More power sockets', author: { id: stu.id } });
    expect(list.body.meta.statusCounts.new).toBeGreaterThan(0);
    expect((await as(admin.token).get('/admin/dashboard')).body.data.kpis.newSuggestions).toBeGreaterThan(0);

    const reviewed = await as(admin.token).patch(`/admin/suggestions/${s.body.data.id}`, { status: 'reviewed', response: 'Electricians will add four sockets.' });
    expect(reviewed.body.data).toMatchObject({ status: 'reviewed', adminResponse: 'Electricians will add four sockets.', reviewedBy: { id: admin.id } });
    const mine = (await as(stu.token).get('/suggestions')).body.data[0];
    expect(mine).toMatchObject({ status: 'reviewed', adminResponse: 'Electricians will add four sockets.' });
  });
});

describe('permanent account deletion', () => {
  it('requires the password and DELETE; frees the slots for the queue and removes the member’s data', async () => {
    const leaver = await member('leaver@chg.edu');
    const d = await campusDate(25);
    const held = (await as(leaver.token).post('/bookings', slot(venueId, d, '08:00', '09:00', 'Leaver booking', '1RV22CS999'))).body.data;
    const waiting = (await as(other.token).post('/bookings', slot(venueId, d, '08:00', '09:00', 'Waiting for it', 'FAC-1024'))).body.data;
    expect(waiting.status).toBe('queued');
    await as(leaver.token).post('/suggestions', { subject: 'A leaving thought', message: 'Please keep the library open later.' });
    const cat = (await pool.query("select id from complaint_categories where slug = 'electrical'")).rows[0].id;
    const c = (await as(leaver.token).post('/complaints', { categoryId: cat, title: 'Flickering light' })).body.data;
    const elec = await staffMember('elec@chg.edu', 'Electrical Department');
    await as(elec.token).post(`/staff/complaints/${c.id}/start`, { version: 1 });

    expect((await as(leaver.token).delete('/me', { password: 'wrong-password-1', confirm: 'DELETE' })).body.error.code).toBe('INVALID_CURRENT_PASSWORD');
    expect((await as(leaver.token).delete('/me', { password: 'Testing12345', confirm: 'delete' })).status).toBe(400);
    const res = await as(leaver.token).delete('/me', { password: 'Testing12345', confirm: 'DELETE' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toEqual({ bookingsDeleted: 1, complaintsDeleted: 1, suggestionsDeleted: 1 });

    // The queued member got the slot; the leaver's data and login are gone; an anonymous audit entry remains.
    expect((await as(other.token).get(`/bookings/${waiting.id}`)).body.data.status).toBe('confirmed');
    for (const [table, col] of [['bookings', 'id'], ['complaints', 'id']] as const) {
      expect((await pool.query(`select 1 from ${table} where ${col} = $1`, [table === 'bookings' ? held.id : c.id])).rowCount).toBe(0);
    }
    expect((await pool.query('select 1 from auth_users where id = $1', [leaver.id])).rowCount).toBe(0);
    expect((await pool.query('select 1 from suggestions where author_id = $1', [leaver.id])).rowCount).toBe(0);
    const auditRow = (await pool.query("select actor_id, summary, ip_address from audit_logs where action = 'user.deleted' and entity_id = $1", [leaver.id])).rows[0];
    expect(auditRow).toEqual({ actor_id: null, summary: 'A student deleted their account', ip_address: null });
    expect((await as(leaver.token).get('/me')).status).toBe(401);
    await expect(signIn('leaver@chg.edu')).rejects.toBeTruthy();
  });

  it('a staff member who worked on others’ complaints leaves them as "Deleted user"', async () => {
    const elec = await staffMember('elec2@chg.edu', 'Electrical Department');
    const cat = (await pool.query("select id from complaint_categories where slug = 'electrical'")).rows[0].id;
    const c = (await as(stu.token).post('/complaints', { categoryId: cat, title: 'Fan noise' })).body.data;
    await as(elec.token).post(`/staff/complaints/${c.id}/start`, { version: 1 });
    expect((await as(elec.token).delete('/me', { password: 'Testing12345', confirm: 'DELETE' })).status).toBe(200);
    const view = (await as(stu.token).get(`/complaints/${c.id}`)).body.data;
    expect(view.status).toBe('in_progress');
    expect(view.handledBy).toBeNull();
    expect(view.history.find((h: { eventType: string }) => h.eventType === 'work_started').actor).toBeNull();
  });

  it('the only Super Admin cannot delete their account; with a second one they can', async () => {
    const solo = await as(admin.token).delete('/me', { password: 'Testing12345', confirm: 'DELETE' });
    expect([solo.status, solo.body.error.code]).toEqual([409, 'LAST_SUPER_ADMIN']);
    const second = await member('admin2@chg.edu', 'super_admin');
    expect((await as(second.token).delete('/me', { password: 'Testing12345', confirm: 'DELETE' })).status).toBe(200);
  });
});
