// COMPLAINT_REGISTRATION_SPEC.md §19 CBT-01…17: the complaint API against the real app, Better Auth and the test DB.
// Photos use the local private store (COMPLAINT_PHOTO_STORE=fake): files under backend/.tmp/private-files, served
// through HMAC-signed, expiring URLs with the same semantics as S3 presigned URLs.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, as, closePools, createVenue, member, resetDb, staffMember } from '../helpers/app.js';
import { pool } from '../helpers/db.js';
import { privateFilesDir, privateStore } from '../../src/lib/storage.js';

type User = { id: string; token: string };
let stu: User, other: User, fac: User, elec: User, elec2: User, plumb: User, admin: User;
let cat: Record<string, string>;
let venueId: string;

const jpeg = (color = '#3366cc', w = 800, h = 600) =>
  sharp({ create: { width: w, height: h, channels: 3, background: color } })
    .jpeg()
    .withExif({ IFD0: { Make: 'TestCam', Model: 'GPS-Phone' } })
    .toBuffer();
const photo = async (name = 'photo.jpg', color?: string) => ({ buffer: await jpeg(color), name });

const fileCount = () => {
  const root = privateFilesDir();
  let n = 0;
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else n++;
    }
  };
  walk(root);
  return n;
};

/** Files a complaint through the API (JSON when no photos) and returns the Complaint DTO. */
async function fileComplaint(u: User, slug = 'electrical', extra: Record<string, unknown> = {}, photos: { buffer: Buffer; name: string }[] = []) {
  const data = { categoryId: cat[slug], title: 'Fan not working in Room 204', locationDetails: 'Block A, Room 204', ...extra };
  const res = photos.length ? await as(u.token).multipart('/complaints', data, photos) : await as(u.token).post('/complaints', data);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data;
}

async function fetchImage(url: string) {
  const u = new URL(url);
  return request(app).get(u.pathname + u.search);
}

beforeAll(async () => {
  await resetDb();
  stu = await member('priya@cmp.edu');
  other = await member('daniel@cmp.edu');
  fac = await member('meera@cmp.edu', 'faculty_staff');
  elec = await staffMember('ravi@cmp.edu', 'Electrical Department');
  elec2 = await staffMember('arun@cmp.edu', 'Electrical Department');
  plumb = await staffMember('sita@cmp.edu', 'Plumbing Department');
  admin = await member('admin@cmp.edu', 'super_admin');
  cat = Object.fromEntries((await pool.query('select slug, id from complaint_categories')).rows.map((r) => [r.slug, r.id]));
  venueId = await createVenue('Complaint Hall');
});
afterAll(closePools);

describe('C01 / C02 filing', () => {
  it('C01 lists active categories with their department, in sort order', async () => {
    const res = await as(stu.token).get('/complaint-categories');
    expect(res.status).toBe(200);
    expect(res.body.data.map((c: any) => c.slug)).toEqual(['electrical', 'plumbing', 'it_network', 'furniture', 'cleanliness', 'civil_infrastructure', 'other']);
    expect(res.body.data[0].department.name).toBe('Electrical Department');
  });

  it('CBT-01: files with 0, 1 and 3 photos; stored objects are WebP without EXIF, rows match', async () => {
    const none = await fileComplaint(stu);
    expect(none.status).toBe('pending_review');
    expect(none.reference).toMatch(/^CMP-\d{4}-\d{6}$/);
    expect(none.department.name).toBe('Electrical Department');
    expect(none.history.map((h: any) => h.eventType)).toEqual(['submitted']);
    expect(none.permissions.canWithdraw).toBe(true);

    const one = await fileComplaint(stu, 'plumbing', { venueId }, [await photo()]);
    expect(one.venue).toEqual({ id: venueId, name: 'Complaint Hall', isActive: true });
    expect(one.attachments.report).toHaveLength(1);

    const three = await fileComplaint(fac, 'it_network', {}, [await photo('a.jpg'), await photo('b.png'), await photo('c.webp')]);
    expect(three.attachments.report).toHaveLength(3);
    expect(three.photoCount).toBe(3);
    const a = three.attachments.report[0];
    expect(new Date(a.expiresAt).getTime() - Date.now()).toBeGreaterThan(590_000);
    const img = await fetchImage(a.url);
    expect(img.status).toBe(200);
    const meta = await sharp(img.body).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    expect([meta.width, meta.height]).toEqual([800, 600]);
    expect((await sharp((await fetchImage(a.thumbUrl)).body).metadata()).width).toBe(480);
    const rows = (await pool.query('select storage_path, thumb_path, kind, uploaded_by from complaint_attachments where complaint_id = $1', [three.id])).rows;
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.kind === 'report' && r.uploaded_by === fac.id && r.storage_path.startsWith(`complaints/${three.id}/`))).toBe(true);
  });

  it('CBT-02: rejects 4 photos, a 6 MB file, a PDF named .jpg and a corrupt JPEG; accepts a PNG named .jpg', async () => {
    const data = { categoryId: cat.electrical, title: 'Bad photos' };
    const four = await as(stu.token).multipart('/complaints', data, await Promise.all([1, 2, 3, 4].map(() => photo())));
    expect([four.status, four.body.error.code]).toEqual([422, 'TOO_MANY_FILES']);
    const big = await as(stu.token).multipart('/complaints', data, [{ buffer: Buffer.alloc(6 * 1024 * 1024, 1), name: 'big.jpg' }]);
    expect([big.status, big.body.error.code]).toEqual([413, 'FILE_TOO_LARGE']);
    const pdf = await as(stu.token).multipart('/complaints', data, [{ buffer: Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\n'), name: 'scan.jpg' }]);
    expect([pdf.status, pdf.body.error.code]).toEqual([415, 'UNSUPPORTED_FILE_TYPE']);
    const good = await jpeg();
    const corrupt = Buffer.concat([good.subarray(0, 400), Buffer.alloc(2000, 7)]);
    const bad = await as(stu.token).multipart('/complaints', data, [{ buffer: corrupt, name: 'broken.jpg' }]);
    expect([bad.status, bad.body.error.code]).toEqual([422, 'IMAGE_UNREADABLE']);
    const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: '#ff0000' } }).png().toBuffer();
    const ok = await as(stu.token).multipart('/complaints', data, [{ buffer: png, name: 'renamed.jpg' }]);
    expect(ok.status).toBe(201);
  });

  it('CBT-03: a database failure after upload deletes the uploaded objects', async () => {
    await pool.query(`create or replace function test_fail_complaint() returns trigger language plpgsql as $$
      begin if new.title = 'FORCE FAIL' then raise exception 'forced failure'; end if; return new; end $$`);
    await pool.query('create trigger test_fail_complaint before insert on complaints for each row execute function test_fail_complaint()');
    try {
      const before = fileCount();
      const res = await as(stu.token).multipart('/complaints', { categoryId: cat.electrical, title: 'FORCE FAIL' }, [await photo(), await photo()]);
      expect(res.status).toBe(500);
      expect(fileCount()).toBe(before);
    } finally {
      await pool.query('drop trigger test_fail_complaint on complaints; drop function test_fail_complaint()');
    }
  });

  it('CBT-04: idempotent replay, open-complaint limit, inactive category, inactive venue', async () => {
    const key = randomUUID();
    const data = { categoryId: cat.furniture, title: 'Broken chair in the library' };
    const first = await as(other.token).post('/complaints', data).set('Idempotency-Key', key);
    const again = await as(other.token).post('/complaints', data).set('Idempotency-Key', key);
    expect([first.status, again.status]).toEqual([201, 200]);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(again.body.data.id).toBe(first.body.data.id);

    await pool.query('update app_settings set complaint_max_open_per_user = 1 where id = 1');
    const limit = await as(other.token).post('/complaints', { categoryId: cat.furniture, title: 'Another chair' });
    expect([limit.status, limit.body.error.code, limit.body.error.details]).toEqual([422, 'OPEN_COMPLAINT_LIMIT_REACHED', { limit: 1, current: 1 }]);
    await pool.query('update app_settings set complaint_max_open_per_user = 10 where id = 1');

    await pool.query(`update complaint_categories set is_active = false where slug = 'other'`);
    const inactive = await as(other.token).post('/complaints', { categoryId: cat.other, title: 'Something else' });
    expect([inactive.status, inactive.body.error.code]).toEqual([422, 'CATEGORY_INACTIVE']);
    await pool.query(`update complaint_categories set is_active = true where slug = 'other'`);

    const v2 = await createVenue('Closed Hall');
    await pool.query('update venues set is_active = false where id = $1', [v2]);
    const venue = await as(other.token).post('/complaints', { categoryId: cat.other, title: 'Lights out', venueId: v2 });
    expect([venue.status, venue.body.error.code]).toEqual([422, 'VENUE_NOT_FOUND']);

    const missing = await as(other.token).post('/complaints', { title: 'No category' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.details.fieldErrors.categoryId).toEqual(['Please select a category']);
    const extra = await as(other.token).post('/complaints', { ...data, status: 'resolved' });
    expect(extra.status).toBe(400);
  });
});

describe('C03–C07 reporter views and actions', () => {
  it('CBT-05: tabs and counts, awaiting complaints first, other users get 404', async () => {
    const u = await member('tabs@cmp.edu');
    const a = await fileComplaint(u, 'electrical', { title: 'First' });
    const b = await fileComplaint(u, 'electrical', { title: 'Second' });
    await as(elec.token).post(`/staff/complaints/${a.id}/start`, { version: 1 });
    await as(elec.token).multipart(`/staff/complaints/${a.id}/complete`, { version: 2 });
    const list = await as(u.token).get('/complaints?tab=open');
    expect(list.body.data.map((c: any) => c.title)).toEqual(['First', 'Second']);
    expect(list.body.data[0].awaitingReporter).toBe(true);
    expect(list.body.meta.counts).toEqual({ open: 2, closed: 0, awaitingYourReview: 1 });
    expect(list.body.data[0].reporter).toBeUndefined();
    expect((await as(u.token).get('/complaints?tab=closed')).body.data).toEqual([]);
    expect((await as(u.token).get('/complaints?q=second')).body.data.map((c: any) => c.id)).toEqual([b.id]);
    const stranger = await as(other.token).get(`/complaints/${a.id}`);
    expect([stranger.status, stranger.body.error.code]).toEqual([404, 'COMPLAINT_NOT_FOUND']);
  });

  it('CBT-06: approve/reject/withdraw status rules, version conflicts and reason validation', async () => {
    const c = await fileComplaint(stu, 'electrical', { title: 'Socket sparks' });
    expect((await as(stu.token).post(`/complaints/${c.id}/approve`, { version: 1 })).body.error.code).toBe('INVALID_STATUS_TRANSITION');
    await as(elec.token).post(`/staff/complaints/${c.id}/start`, { version: 1 });
    const w = await as(stu.token).post(`/complaints/${c.id}/withdraw`, { version: 2 });
    expect([w.status, w.body.error.message]).toEqual([409, "Work has already started, so this complaint can't be withdrawn."]);
    await as(elec.token).multipart(`/staff/complaints/${c.id}/complete`, { version: 2, note: 'Replaced the socket' });
    expect((await as(stu.token).post(`/complaints/${c.id}/reject`, { version: 3, reason: 'no' })).status).toBe(400);
    expect((await as(stu.token).post(`/complaints/${c.id}/reject`, { version: 3, reason: 'x'.repeat(301) })).status).toBe(400);
    const stale = await as(stu.token).post(`/complaints/${c.id}/reject`, { version: 2, reason: 'Still sparks' });
    expect([stale.status, stale.body.error.code]).toEqual([409, 'COMPLAINT_CHANGED']);
    const rej = await as(stu.token).post(`/complaints/${c.id}/reject`, { version: 3, reason: 'Still sparks when plugged in' });
    expect(rej.body.data.status).toBe('in_progress');
    expect(rej.body.data.rejectedByReporter).toBe(true);
    expect(rej.body.data.rejectionReason).toBe('Still sparks when plugged in');

    const d = await fileComplaint(stu, 'cleanliness', { title: 'Dusty corridor' });
    const wd = await as(stu.token).post(`/complaints/${d.id}/withdraw`, { version: 1, reason: 'Filed by mistake' });
    expect(wd.body.data.status).toBe('withdrawn');
    expect(wd.body.data.closureReason).toBe('Filed by mistake');
    expect((await as(stu.token).post(`/complaints/${d.id}/withdraw`, { version: 2 })).status).toBe(409);
    expect((await as(other.token).post(`/complaints/${c.id}/approve`, { version: 4 })).status).toBe(404);
  });
});

describe('C08–C14 department staff', () => {
  it('CBT-07: staff see only their department; others 404; inactive department 403; members 403', async () => {
    const c = await fileComplaint(stu, 'plumbing', { title: 'Leaking tap' });
    expect((await as(plumb.token).get(`/staff/complaints/${c.id}`)).status).toBe(200);
    expect((await as(elec.token).get(`/staff/complaints/${c.id}`)).status).toBe(404);
    expect((await as(elec.token).post(`/staff/complaints/${c.id}/start`, { version: 1 })).status).toBe(404);
    const queue = await as(elec.token).get('/staff/complaints?tab=all');
    expect(queue.body.data.every((x: any) => x.department.name === 'Electrical Department')).toBe(true);
    expect(queue.body.data[0].reporter).toBeDefined();
    expect((await as(stu.token).get('/staff/dashboard')).status).toBe(403);
    expect((await as(admin.token).get('/staff/dashboard')).status).toBe(403);
    await pool.query(`update service_departments set is_active = false where name = 'Plumbing Department'`);
    const inactive = await as(plumb.token).get('/staff/dashboard');
    expect([inactive.status, inactive.body.error.code]).toEqual([403, 'DEPARTMENT_INACTIVE']);
    await pool.query(`update service_departments set is_active = true where name = 'Plumbing Department'`);
    const dash = await as(plumb.token).get('/staff/dashboard');
    expect(dash.body.data.department.name).toBe('Plumbing Department');
    expect(dash.body.data.counts.new).toBeGreaterThanOrEqual(1);
  });

  it('CBT-08: start → complete with photo → reject → complete → approve → reopen, with history and handler', async () => {
    const c = await fileComplaint(stu, 'electrical', { title: 'Fan regulator broken' }, [await photo()]);
    let r = await as(elec.token).post(`/staff/complaints/${c.id}/start`, { version: 1, note: 'Will check after 2 pm.' });
    expect([r.body.data.status, r.body.data.handledBy.id]).toEqual(['in_progress', elec.id]);
    r = await as(elec.token).multipart(`/staff/complaints/${c.id}/complete`, { version: 2, note: 'Replaced the fan regulator.' }, [await photo('after.jpg')]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.status).toBe('awaiting_confirmation');
    expect(r.body.data.attachments.resolution).toHaveLength(1);
    const mine = await as(stu.token).get(`/complaints/${c.id}`);
    expect(mine.body.data.resolutionNote).toBe('Replaced the fan regulator.');
    expect(mine.body.data.autoResolveAt).not.toBeNull();
    expect(mine.body.data.permissions).toMatchObject({ canApprove: true, canReject: true, canWithdraw: false, canStart: false });
    expect(mine.body.data.reassignmentNote).toBeNull();
    await as(stu.token).post(`/complaints/${c.id}/reject`, { version: 3, reason: 'Still noisy' });
    const queue = await as(elec.token).get('/staff/complaints?tab=in_progress&flag=rejected');
    expect(queue.body.data.map((x: any) => x.id)).toContain(c.id);
    await as(elec.token).multipart(`/staff/complaints/${c.id}/complete`, { version: 4, note: 'Lubricated the bearing.' });
    const ok = await as(stu.token).post(`/complaints/${c.id}/approve`, { version: 5 });
    expect(ok.body.data.status).toBe('resolved');
    expect(ok.body.data.rejectionReason).toBeNull();
    expect(ok.body.data.autoResolved).toBe(false);
    expect(ok.body.data.permissions.canReopen).toBe(false); // approved by the reporter: no reporter reopen
    const re = await as(elec2.token).post(`/staff/complaints/${c.id}/reopen`, { version: 6, note: 'Fan stopped again.' });
    expect([re.body.data.status, re.body.data.handledBy.id, re.body.data.resolvedAt]).toEqual(['in_progress', elec.id, null]);
    expect(re.body.data.history.map((h: any) => h.eventType)).toEqual([
      'submitted', 'work_started', 'work_completed', 'rejected', 'work_completed', 'approved', 'reopened',
    ]);
    expect(re.body.data.history[1]).toMatchObject({ note: 'Will check after 2 pm.', actor: { id: elec.id, role: 'department_staff' } });
    const fourth = await as(elec.token).multipart(`/staff/complaints/${c.id}/complete`, { version: 7 }, [await photo(), await photo(), await photo()]);
    expect([fourth.status, fourth.body.error.code]).toEqual([422, 'TOO_MANY_FILES']);
  });

  it('CBT-09: request reassignment (once), admin reassigns to another queue, dismiss clears the flag', async () => {
    const c = await fileComplaint(stu, 'electrical', { title: 'Water near the switchboard' });
    const req = await as(elec.token).post(`/staff/complaints/${c.id}/request-reassignment`, { version: 1, reason: 'This is a water leak.', suggestedCategoryId: cat.plumbing });
    expect(req.body.data.reassignmentRequested).toBe(true);
    expect(req.body.data.reassignmentSuggestedCategory.name).toBe('Plumbing');
    const dup = await as(elec.token).post(`/staff/complaints/${c.id}/request-reassignment`, { version: 2, reason: 'Again please' });
    expect([dup.status, dup.body.error.code]).toEqual([409, 'REASSIGNMENT_ALREADY_REQUESTED']);
    const flagged = await as(admin.token).get('/admin/complaints?flag=reassignment');
    expect(flagged.body.data.map((x: any) => x.id)).toContain(c.id);
    const same = await as(admin.token).post(`/admin/complaints/${c.id}/reassign`, { version: 2, categoryId: cat.electrical, note: 'Same' });
    expect(same.status).toBe(400);
    const moved = await as(admin.token).post(`/admin/complaints/${c.id}/reassign`, { version: 2, categoryId: cat.plumbing, note: 'Water leak — moved to Plumbing.' });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect([moved.body.data.status, moved.body.data.department.name, moved.body.data.reassignmentRequested]).toEqual([
      'pending_review', 'Plumbing Department', false,
    ]);
    const last = moved.body.data.history.at(-1);
    expect(last.eventType).toBe('reassigned');
    expect(last.changes.department).toEqual({ fromName: 'Electrical Department', toName: 'Plumbing Department' });
    expect((await as(elec.token).get(`/staff/complaints/${c.id}`)).status).toBe(404);
    expect((await as(plumb.token).get('/staff/complaints?tab=new')).body.data.map((x: any) => x.id)).toContain(c.id);
    const audit = await pool.query(`select action from audit_logs where entity_type = 'complaint' and entity_id = $1`, [c.id]);
    expect(audit.rows.map((r) => r.action)).toEqual(['complaint.reassigned']);

    const d = await fileComplaint(stu, 'electrical', { title: 'Odd smell from a socket' });
    await as(elec.token).post(`/staff/complaints/${d.id}/request-reassignment`, { version: 1, reason: 'Probably housekeeping' });
    const dismissed = await as(admin.token).post(`/admin/complaints/${d.id}/reassign`, { version: 2, dismiss: true, note: 'Electrical issue after all.' });
    expect([dismissed.body.data.reassignmentRequested, dismissed.body.data.department.name]).toEqual([false, 'Electrical Department']);
    expect(dismissed.body.data.history.at(-1).eventType).toBe('reassignment_dismissed');
  });
});

describe('C15–C29 administration', () => {
  it('CBT-10: close with a type; closed is immutable; resolved cannot be closed', async () => {
    const c = await fileComplaint(stu, 'other', { title: 'Duplicate of an earlier issue' });
    expect((await as(admin.token).post(`/admin/complaints/${c.id}/close`, { version: 1, reason: 'Dup' })).status).toBe(400);
    const closed = await as(admin.token).post(`/admin/complaints/${c.id}/close`, { version: 1, closureType: 'duplicate', reason: 'Same issue as an earlier report.' });
    expect([closed.body.data.status, closed.body.data.closureType]).toEqual(['closed', 'duplicate']);
    expect((await as(admin.token).post(`/admin/complaints/${c.id}/start`, { version: 2 })).status).toBe(409);
    expect((await as(stu.token).post(`/complaints/${c.id}/withdraw`, { version: 2 })).status).toBe(409);
    const view = await as(stu.token).get(`/complaints/${c.id}`);
    expect(view.body.data.closureReason).toBe('Same issue as an earlier report.');
  });

  it('CBT-11: department and category setup — uniqueness, slugs, deactivation blocked with counts', async () => {
    const dept = await as(admin.token).post('/admin/service-departments', { name: 'Security Office', description: 'Locks, access cards, CCTV' });
    expect(dept.status).toBe(201);
    expect((await as(admin.token).post('/admin/service-departments', { name: 'security office' })).body.error.code).toBe('DEPARTMENT_NAME_TAKEN');
    const c1 = await as(admin.token).post('/admin/complaint-categories', { name: 'Security', icon: 'lock', color: '#334155', departmentId: dept.body.data.id, sortOrder: 80 });
    expect([c1.status, c1.body.data.slug]).toEqual([201, 'security']);
    expect((await as(admin.token).post('/admin/complaint-categories', { name: 'SECURITY', departmentId: dept.body.data.id })).body.error.code).toBe('CATEGORY_NAME_TAKEN');
    await pool.query(`insert into complaint_categories (slug, name, department_id) values ('lab_safety', 'Lab safety (old)', $1)`, [dept.body.data.id]);
    const c2 = await as(admin.token).post('/admin/complaint-categories', { name: 'Lab Safety!', departmentId: dept.body.data.id });
    expect(c2.body.data.slug).toBe('lab_safety_2');
    const blocked = await as(admin.token).patch(`/admin/service-departments/${dept.body.data.id}`, { isActive: false });
    expect([blocked.status, blocked.body.error.code, blocked.body.error.details.activeCategories]).toEqual([409, 'DEPARTMENT_IN_USE', 3]);
    for (const id of [c1.body.data.id, c2.body.data.id]) await as(admin.token).patch(`/admin/complaint-categories/${id}`, { isActive: false });
    await pool.query(`update complaint_categories set is_active = false where slug = 'lab_safety'`);
    const off = await as(admin.token).patch(`/admin/service-departments/${dept.body.data.id}`, { isActive: false });
    expect(off.body.data.isActive).toBe(false);
    const reactivate = await as(admin.token).patch(`/admin/complaint-categories/${c1.body.data.id}`, { isActive: true });
    expect([reactivate.status, reactivate.body.error.code]).toEqual([422, 'DEPARTMENT_INACTIVE']);
    const list = await as(admin.token).get('/admin/service-departments');
    expect(list.body.data.find((d: any) => d.name === 'Electrical Department').counts.activeStaff).toBe(2);
    const actions = (await pool.query(`select action from audit_logs where entity_type in ('service_department','complaint_category') order by id`)).rows.map((r) => r.action);
    expect(actions).toEqual([
      'service_department.created', 'complaint_category.created', 'complaint_category.created', 'complaint_category.deactivated',
      'complaint_category.deactivated', 'service_department.deactivated',
    ]);
  });

  it('CBT-12: department staff accounts require an active department; leaving the role clears it', async () => {
    const elecId = (await pool.query(`select id from service_departments where name = 'Electrical Department'`)).rows[0].id;
    const base = { fullName: 'New Staff', email: 'newstaff@cmp.edu', temporaryPassword: 'Temp12345' };
    const missing = await as(admin.token).post('/admin/users', { ...base, role: 'department_staff' });
    expect([missing.status, missing.body.error.code]).toEqual([422, 'SERVICE_DEPARTMENT_REQUIRED']);
    const wrong = await as(admin.token).post('/admin/users', { ...base, role: 'student', serviceDepartmentId: elecId });
    expect(wrong.status).toBe(400);
    const made = await as(admin.token).post('/admin/users', { ...base, role: 'department_staff', serviceDepartmentId: elecId });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.data.serviceDepartment).toEqual({ id: elecId, name: 'Electrical Department', isActive: true });
    const demoted = await as(admin.token).patch(`/admin/users/${made.body.data.id}`, { role: 'faculty_staff' });
    expect([demoted.body.data.role, demoted.body.data.serviceDepartment]).toEqual(['faculty_staff', null]);
    const staffList = await as(admin.token).get(`/admin/users?role=department_staff&serviceDepartmentId=${elecId}`);
    expect(staffList.body.data.map((u: any) => u.email).sort()).toEqual(['arun@cmp.edu', 'ravi@cmp.edu']);
    const me = await as(elec.token).get('/me');
    expect(me.body.data.serviceDepartment.name).toBe('Electrical Department');
  });

  it('CBT-13: report aggregates and CSV export with the formula-injection guard', async () => {
    await resetDb();
    stu = await member('priya@cmp.edu');
    other = await member('daniel@cmp.edu');
    elec = await staffMember('ravi@cmp.edu', 'Electrical Department');
    admin = await member('admin@cmp.edu', 'super_admin');
    cat = Object.fromEntries((await pool.query('select slug, id from complaint_categories')).rows.map((r) => [r.slug, r.id]));
    const a = await fileComplaint(stu, 'electrical', { title: '=HYPERLINK("http://evil")' });
    const b = await fileComplaint(stu, 'electrical', { title: 'Second light' });
    const c = await fileComplaint(stu, 'plumbing', { title: 'Drip' });
    await fileComplaint(stu, 'plumbing', { title: 'Withdrawn one' }).then((x) => as(stu.token).post(`/complaints/${x.id}/withdraw`, { version: 1 }));
    for (const x of [a, b]) {
      await as(elec.token).post(`/staff/complaints/${x.id}/start`, { version: 1 });
      await as(elec.token).multipart(`/staff/complaints/${x.id}/complete`, { version: 2 });
    }
    await as(stu.token).post(`/complaints/${a.id}/reject`, { version: 3, reason: 'Not fixed' });
    await as(elec.token).multipart(`/staff/complaints/${a.id}/complete`, { version: 4 });
    await as(stu.token).post(`/complaints/${a.id}/approve`, { version: 5 });
    // b is auto-resolved
    await pool.query(`update complaints set work_completed_at = now() - interval '8 days' where id = $1`, [b.id]);
    const job = await request(app).post('/internal/jobs/run?tasks=complaints').set('authorization', `Bearer ${process.env.CRON_SECRET ?? ''}`);
    expect(job.body.data.complaintsAutoResolved).toBe(1);
    const rep = (await as(admin.token).get('/admin/reports/complaints')).body.data;
    expect(rep.totals).toMatchObject({ submitted: 4, resolved: 2, withdrawn: 1, pending_review: 1 });
    expect(rep.resolutionRate).toBe(Math.round((2 / 3) * 1000) / 1000);
    expect(rep.reopenRate).toBe(0.5); // a was rejected once; a and b had work completed
    expect(rep.autoResolvedShare).toBe(0.5);
    expect(rep.byCategory.map((x: any) => [x.name, x.count, x.resolved])).toEqual([['Electrical', 2, 2], ['Plumbing', 2, 0]]);
    expect(rep.aging).toEqual({ under2Days: 1, from2To7Days: 0, over7Days: 0 });
    expect(rep.byReporterRole).toEqual([{ role: 'student', count: 4 }]);
    expect(rep.trend).toHaveLength(30);
    void c;

    const csv = await as(admin.token).get('/admin/complaints/export.csv?status=resolved');
    expect(csv.headers['content-type']).toContain('text/csv');
    const lines = csv.text.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines[0]).toBe(
      'reference,created_at,title,category,department,venue,location,status,reporter_name,reporter_email,reporter_role,handled_by,work_started_at,work_completed_at,resolved_at,closed_at,closure_type,closure_reason,rejection_count,resolution_hours',
    );
    expect(lines).toHaveLength(3);
    expect(csv.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });

  it('admin dashboard, venue issues and member dashboard include complaint data', async () => {
    const v = await createVenue('Issue Hall');
    const c = await fileComplaint(stu, 'electrical', { title: 'Mic not working', venueId: v });
    const dash = (await as(admin.token).get('/admin/dashboard')).body.data;
    expect(dash.complaintKpis.open).toBeGreaterThanOrEqual(1);
    expect(dash.complaintKpis).toHaveProperty('avgResolutionHours30d');
    expect((await as(admin.token).get(`/admin/venues/${v}`)).body.data.stats.openComplaints).toBe(1);
    expect((await as(admin.token).get(`/admin/complaints?venueId=${v}`)).body.data.map((x: any) => x.id)).toEqual([c.id]);
    const me = (await as(stu.token).get('/me/dashboard')).body.data;
    expect(me.complaints.open).toBeGreaterThanOrEqual(1);
    expect(me.recentComplaints[0].id).toBeDefined();
    const pub = (await request(app).get('/api/v1/settings/public')).body.data.complaintRules;
    expect(pub).toEqual({ maxPhotos: 3, maxPhotoMb: 5, acceptedTypes: ['image/jpeg', 'image/png', 'image/webp'], autoResolveDays: 7, reopenWindowDays: 7, maxOpenPerUser: 10 });
    const set = await as(admin.token).patch('/admin/settings', { complaintAutoResolveDays: null, complaintReopenWindowDays: 3 });
    expect([set.body.data.complaintAutoResolveDays, set.body.data.complaintReopenWindowDays]).toEqual([null, 3]);
    await as(admin.token).patch('/admin/settings', { complaintAutoResolveDays: 7, complaintReopenWindowDays: 7 });
    const statuses = (await as(admin.token).get('/admin/complaints?status=pending_review')).body.meta.statusCounts;
    expect(statuses.all).toBeGreaterThan(statuses.pending_review);
  });

  it('CBT-14: concurrent starts and approve-vs-close: exactly one succeeds', async () => {
    const elecB = await staffMember('race@cmp.edu', 'Electrical Department');
    const c = await fileComplaint(stu, 'electrical', { title: 'Race to start' });
    const starts = await Promise.all([elec, elecB].map((u) => as(u.token).post(`/staff/complaints/${c.id}/start`, { version: 1 })));
    expect(starts.map((r) => r.status).sort()).toEqual([200, 409]);
    await as(elec.token).multipart(`/staff/complaints/${c.id}/complete`, { version: 2 });
    const [approve, close] = await Promise.all([
      as(stu.token).post(`/complaints/${c.id}/approve`, { version: 3 }),
      as(admin.token).post(`/admin/complaints/${c.id}/close`, { version: 3, closureType: 'other', reason: 'Closing it' }),
    ]);
    expect([approve.status, close.status].sort()).toEqual([200, 409]);
  });

  it('CBT-15: signed URLs carry a ~600 s expiry; unsigned, tampered and expired URLs return nothing', async () => {
    const c = await fileComplaint(stu, 'furniture', { title: 'Wobbly bench' }, [await photo()]);
    const a = c.attachments.report[0];
    expect((await fetchImage(a.url)).status).toBe(200);
    const u = new URL(a.url);
    expect((await request(app).get(u.pathname)).status).toBe(404);
    expect((await request(app).get(`${u.pathname}?expires=${u.searchParams.get('expires')}&sig=AAAA`)).status).toBe(404);
    const key = decodeURIComponent(u.pathname.replace('/dev-files/', ''));
    const [expired] = await privateStore.signedUrls([key], -5);
    expect((await fetchImage(expired!.url)).status).toBe(404);
    expect((await as(other.token).get(`/complaints/${c.id}`)).status).toBe(404);
  });

  it('CBT-16: reporter reopen of an auto-resolved complaint inside the window only', async () => {
    const make = async (resolvedDaysAgo: number, how: 'auto' | 'approve') => {
      const c = await fileComplaint(stu, 'electrical', { title: `Reopen ${how} ${resolvedDaysAgo}` });
      await as(elec.token).post(`/staff/complaints/${c.id}/start`, { version: 1 });
      await as(elec.token).multipart(`/staff/complaints/${c.id}/complete`, { version: 2 });
      if (how === 'approve') await as(stu.token).post(`/complaints/${c.id}/approve`, { version: 3 });
      else {
        await pool.query(`update complaints set work_completed_at = now() - interval '8 days' where id = $1`, [c.id]);
        await pool.query('select auto_resolve_complaints()');
      }
      await pool.query(`update complaints set resolved_at = now() - make_interval(days => $2) where id = $1`, [c.id, resolvedDaysAgo]);
      return (await as(stu.token).get(`/complaints/${c.id}`)).body.data;
    };
    const fresh = await make(2, 'auto');
    expect([fresh.autoResolved, fresh.permissions.canReopen]).toEqual([true, true]);
    expect(new Date(fresh.reporterReopenUntil).getTime()).toBeGreaterThan(Date.now());
    expect((await as(stu.token).post(`/complaints/${fresh.id}/reopen`, { version: fresh.version, reason: 'ok' })).status).toBe(400);
    expect((await as(stu.token).post(`/complaints/${fresh.id}/reopen`, { version: fresh.version - 1, reason: 'Broken again' })).body.error.code).toBe(
      'COMPLAINT_CHANGED',
    );
    expect((await as(other.token).post(`/complaints/${fresh.id}/reopen`, { version: fresh.version, reason: 'Broken again' })).status).toBe(404);
    const re = await as(stu.token).post(`/complaints/${fresh.id}/reopen`, { version: fresh.version, reason: 'The fan stopped working again.' });
    expect(re.status).toBe(200);
    expect([re.body.data.status, re.body.data.rejectedByReporter, re.body.data.rejectionReason]).toEqual(['in_progress', true, 'The fan stopped working again.']);
    expect(re.body.data.history.at(-1)).toMatchObject({ eventType: 'reopened', actor: { id: stu.id }, note: 'The fan stopped working again.' });

    const old = await make(8, 'auto');
    expect([old.permissions.canReopen, old.reporterReopenUntil !== null]).toEqual([false, true]);
    const late = await as(stu.token).post(`/complaints/${old.id}/reopen`, { version: old.version, reason: 'Broken again' });
    expect([late.status, late.body.error.code]).toEqual([422, 'REOPEN_WINDOW_CLOSED']);
    expect(late.body.error.details.reopenUntil).toBe(old.reporterReopenUntil);

    const approved = await make(1, 'approve');
    expect([approved.permissions.canReopen, approved.reporterReopenUntil]).toEqual([false, null]);
    expect((await as(stu.token).post(`/complaints/${approved.id}/reopen`, { version: approved.version, reason: 'Broken again' })).status).toBe(409);

    await pool.query('update app_settings set complaint_reopen_window_days = 0 where id = 1');
    const off = await make(1, 'auto');
    expect(off.permissions.canReopen).toBe(false);
    expect((await as(stu.token).post(`/complaints/${off.id}/reopen`, { version: off.version, reason: 'Broken again' })).body.error.code).toBe('REOPEN_WINDOW_CLOSED');
    await pool.query('update app_settings set complaint_reopen_window_days = 7 where id = 1');
    // Staff can still reopen the late one (CB-10).
    expect((await as(elec.token).post(`/staff/complaints/${old.id}/reopen`, { version: old.version })).status).toBe(200);
  });

  it('CBT-17: department staff can use the booking endpoints like any member', async () => {
    const v = await createVenue('Staff Hall');
    const { rows } = await pool.query(`select to_char((now() at time zone 'UTC')::date + 7, 'YYYY-MM-DD') as d`);
    const res = await as(elec.token).post('/bookings', { venueId: v, date: rows[0].d, startTime: '10:00', endTime: '11:00', purpose: 'Electrical safety briefing' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await as(elec.token).get('/me/dashboard')).status).toBe(200);
    expect((await as(elec.token).get('/venues')).status).toBe(200);
  });
});
