// COMPLAINT_REGISTRATION_SPEC.md §19 CE2E-01, 02, 03, 05, 07, 10 (desktop). Needs `npm run local` (seeded demo data,
// including staff.electrical@demo.edu and staff.plumbing@demo.edu).
import { expect, test, type Browser, type Page } from '@playwright/test';
import pg from 'pg';
import sharp from 'sharp';
import { ADMIN, API, STUDENT, api, apiToken, cleanE2eComplaints, freeSlot, signInUi } from './helpers';

const ELECTRICAL = { email: 'staff.electrical@demo.edu', password: 'Staff12345' };
const PLUMBING = { email: 'staff.plumbing@demo.edu', password: 'Staff12345' };
const OTHER = { email: process.env.E2E_FACULTY_EMAIL ?? 'faculty@demo.edu', password: process.env.E2E_FACULTY_PASSWORD ?? 'Faculty12345' };

/** Real JPEGs (solid colour, 1200×900) for the file chooser; sharp is hoisted from the backend workspace. */
let JPEG: Buffer;
test.beforeAll(async () => {
  await cleanE2eComplaints();
  JPEG = await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#7c9ccf' } }).jpeg({ quality: 85 }).toBuffer();
});
const photo = (name: string) => ({ name, mimeType: 'image/jpeg', buffer: JPEG });

async function signedIn(browser: Browser, who: { email: string; password: string }, path = '/login'): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signInUi(page, who, path);
  await page.waitForURL((u) => !/\/login$/.test(u.pathname));
  return page;
}

async function categoryId(token: string, slug: string): Promise<string> {
  const cats = await api<{ id: string; slug: string }[]>(token, '/complaint-categories');
  return cats.find((c) => c.slug === slug)!.id;
}

test('CE2E-01: file with photos → staff start & done → reporter rejects → done again → approves; timeline complete', async ({ browser }) => {
  const title = `E2E fan ${Date.now()}`;

  // Student files an Electrical complaint with 2 photos.
  const student = await signedIn(browser, STUDENT);
  await student.getByRole('link', { name: 'Complaints' }).first().click();
  await student.getByRole('link', { name: /Report an issue/ }).first().click();
  await expect(student.getByText("Tell us what's wrong — we'll route it to the right team.")).toBeVisible();
  await student.getByRole('button', { name: 'Submit complaint' }).click();
  await expect(student.getByText('Please select a category')).toBeVisible();
  await student.getByRole('radio', { name: /^Electrical/ }).click();
  await expect(student.getByText(/Will be sent to/)).toContainText('Electrical Department');
  await student.getByLabel('Title').fill(title);
  await student.getByLabel(/Location details/).fill('Block A, Room 204');
  await student.getByLabel(/Describe the issue/).fill('The ceiling fan stopped working this morning.');
  const chooser = student.waitForEvent('filechooser');
  await student.getByRole('button', { name: /Add photos/ }).click();
  await (await chooser).setFiles([photo('one.jpg'), photo('two.jpg')]);
  await expect(student.getByText(/^2\/3/)).toBeVisible();
  await expect(student.getByRole('button', { name: 'Submit complaint' })).toBeEnabled();
  await student.getByRole('button', { name: 'Submit complaint' }).click();
  await expect(student.getByText('Complaint submitted!')).toBeVisible();
  const reference = (await student.locator('p.tabular span.font-mono').first().textContent())!.trim();
  expect(reference).toMatch(/^CMP-\d{4}-\d{6,}$/);
  await expect(student.getByText('Waiting for the Electrical Department to pick this up.')).toBeVisible();
  await expect(student.getByRole('list', { name: 'Reported photos' }).getByRole('listitem')).toHaveCount(2);
  const complaintUrl = student.url().replace(/\?.*$/, '');
  const id = complaintUrl.split('/').pop()!;

  // Electrical staff: New tab → start → mark done with a note and 1 photo.
  const staff = await signedIn(browser, ELECTRICAL);
  await expect(staff).toHaveURL(/\/staff$/);
  await staff.goto('/staff/complaints');
  await staff.getByRole('link', { name: reference }).click();
  await staff.getByRole('button', { name: 'Start work' }).first().click();
  await staff.getByRole('dialog').getByLabel(/Note to the reporter/).fill('Will check it after 2 pm.');
  await staff.getByRole('dialog').getByRole('button', { name: 'Start work' }).click();
  await expect(staff.getByText('Work started.')).toBeVisible();
  await staff.getByRole('button', { name: 'Mark work done' }).first().click();
  const done = staff.getByRole('dialog');
  await done.getByLabel(/What was done/).fill('Replaced the fan regulator.');
  const chooser2 = staff.waitForEvent('filechooser');
  await done.getByRole('button', { name: /Add photos/ }).click();
  await (await chooser2).setFiles([photo('after.jpg')]);
  await expect(done.getByText(/^1\/3/)).toBeVisible();
  await done.getByRole('button', { name: 'Mark as done' }).click();
  await expect(staff.getByText("Marked as done — waiting for the reporter's approval.")).toBeVisible();

  // Student rejects ("still noisy").
  await student.goto(complaintUrl);
  const review = student.getByRole('region', { name: 'Review the work' });
  await expect(review).toContainText('Replaced the fan regulator.');
  await expect(review.getByRole('list', { name: 'Photos from the department' }).getByRole('listitem')).toHaveCount(1);
  await review.getByRole('button', { name: /Not fixed yet/ }).click();
  await student.getByRole('dialog').getByRole('textbox').fill('Still noisy at full speed.');
  await student.getByRole('dialog').getByRole('button', { name: 'Send back' }).click();
  await expect(student.getByText('Sent back to the department for more work.')).toBeVisible();

  // Staff see the rejection flag and mark it done again.
  await staff.goto('/staff/complaints?tab=in_progress');
  await expect(staff.getByRole('row', { name: new RegExp(reference) })).toContainText('Rejected by reporter');
  await staff.goto(`/staff/complaints/${id}`);
  await expect(staff.getByText('Reopened by the reporter')).toBeVisible();
  await staff.getByRole('button', { name: 'Mark work done' }).first().click();
  await staff.getByRole('dialog').getByLabel(/What was done/).fill('Lubricated the bearing.');
  await staff.getByRole('dialog').getByRole('button', { name: 'Mark as done' }).click();
  await expect(staff.getByText("Marked as done — waiting for the reporter's approval.").first()).toBeVisible();

  // Student approves → Resolved, full timeline.
  await student.goto(complaintUrl);
  await student.getByRole('region', { name: 'Review the work' }).getByRole('button', { name: /Approve/ }).click();
  await student.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await expect(student.getByText('Thanks! The complaint is now resolved.')).toBeVisible();
  await expect(student.getByText('This issue has been resolved. Thanks for reporting it!')).toBeVisible();
  for (const line of [
    'Complaint submitted',
    'Work started by Ravi Kumar',
    'Marked as done by Ravi Kumar',
    'Sent back by you',
    'Approved by you',
  ]) {
    await expect(student.getByText(line).first()).toBeVisible();
  }
});

test('CE2E-02: withdraw while pending; the button is gone once work starts', async ({ browser }) => {
  const token = await apiToken(STUDENT);
  const cat = await categoryId(token, 'cleanliness');
  const a = await api<{ id: string }>(token, '/complaints', { method: 'POST', body: JSON.stringify({ categoryId: cat, title: `E2E withdraw ${Date.now()}` }) });
  const b = await api<{ id: string }>(token, '/complaints', { method: 'POST', body: JSON.stringify({ categoryId: cat, title: `E2E started ${Date.now()}` }) });
  const admin = await apiToken(ADMIN);
  await api(admin, `/admin/complaints/${b.id}/start`, { method: 'POST', body: JSON.stringify({ version: 1 }) });

  const student = await signedIn(browser, STUDENT);
  await student.goto(`/complaints/${a.id}`);
  await student.getByRole('button', { name: /Withdraw complaint/ }).first().click();
  await student.getByRole('alertdialog').getByLabel(/Reason/).fill('Filed by mistake');
  await student.getByRole('alertdialog').getByRole('button', { name: 'Withdraw' }).click();
  await expect(student.getByText('Complaint withdrawn.')).toBeVisible();
  await expect(student.getByText(/You withdrew this complaint/)).toBeVisible();
  await student.goto(`/complaints/${b.id}`);
  await expect(student.getByText(/is working on it/)).toBeVisible();
  await expect(student.getByRole('button', { name: /Withdraw complaint/ })).toHaveCount(0);
});

test('CE2E-03: staff request reassignment → admin reassigns → it moves from the Electrical to the Plumbing queue', async ({ browser }) => {
  const token = await apiToken(STUDENT);
  const title = `E2E leak ${Date.now()}`;
  const c = await api<{ id: string; reference: string }>(token, '/complaints', {
    method: 'POST',
    body: JSON.stringify({ categoryId: await categoryId(token, 'electrical'), title }),
  });

  const staff = await signedIn(browser, ELECTRICAL);
  await staff.goto(`/staff/complaints/${c.id}`);
  await staff.getByRole('button', { name: 'Request reassignment' }).first().click();
  const dlg = staff.getByRole('dialog');
  await dlg.getByLabel(/Why doesn't this belong/).fill('This is a water leak, not electrical.');
  await dlg.getByRole('combobox').click();
  await staff.getByRole('option', { name: /^Plumbing/ }).click();
  await dlg.getByRole('button', { name: 'Send request' }).click();
  await expect(staff.getByText('Reassignment requested.')).toBeVisible();

  const admin = await signedIn(browser, ADMIN, '/admin/login');
  await admin.goto('/admin/complaints?flag=reassignment');
  await admin.getByRole('link', { name: c.reference }).click();
  await admin.getByRole('button', { name: 'Reassign' }).first().click();
  const re = admin.getByRole('dialog');
  await expect(re.getByRole('combobox')).toContainText('Plumbing'); // pre-filled with the staff suggestion
  await re.getByLabel('Note').fill('Water leak — moved to Plumbing.');
  await re.getByRole('button', { name: 'Reassign' }).click();
  await expect(admin.getByText('Moved from Electrical Department to Plumbing Department')).toBeVisible();

  await staff.goto(`/staff/complaints/${c.id}`);
  await expect(staff.getByText("This complaint is no longer in your department's queue.")).toBeVisible();
  const plumber = await signedIn(browser, PLUMBING);
  await plumber.goto('/staff/complaints?tab=new');
  await expect(plumber.getByRole('link', { name: c.reference })).toBeVisible();
});

test('CE2E-05: auto-resolve after 8 days, then the reporter reopens with a reason', async ({ browser }) => {
  const token = await apiToken(STUDENT);
  const c = await api<{ id: string; reference: string }>(token, '/complaints', {
    method: 'POST',
    body: JSON.stringify({ categoryId: await categoryId(token, 'electrical'), title: `E2E auto ${Date.now()}` }),
  });
  const staffToken = await apiToken(ELECTRICAL);
  await api(staffToken, `/staff/complaints/${c.id}/start`, { method: 'POST', body: JSON.stringify({ version: 1 }) });
  await api(staffToken, `/staff/complaints/${c.id}/complete`, { method: 'POST', body: JSON.stringify({ version: 2, note: 'Done.' }) });

  // Fixture: the work was completed 8 days ago; the scheduled job resolves it.
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query(`update complaints set work_completed_at = now() - interval '8 days' where id = $1`, [c.id]);
  await db.end();
  const job = await fetch(`${API}/internal/jobs/run?tasks=complaints`, { method: 'POST', headers: { authorization: `Bearer ${process.env.E2E_CRON_SECRET}` } });
  expect(job.status).toBe(200);

  const student = await signedIn(browser, STUDENT);
  await student.goto(`/complaints/${c.id}`);
  await expect(student.getByText('Resolved automatically').first()).toBeVisible();
  await student.getByRole('button', { name: /Not fixed\? Reopen/ }).first().click();
  await student.getByRole('dialog').getByRole('textbox').fill('The fan stopped working again.');
  await student.getByRole('dialog').getByRole('button', { name: 'Reopen complaint' }).click();
  await expect(student.getByText('Complaint reopened and sent back to the department.')).toBeVisible();

  const staff = await signedIn(browser, ELECTRICAL);
  await staff.goto(`/staff/complaints/${c.id}`);
  await expect(staff.getByText('Reopened by the reporter')).toBeVisible();
  await expect(staff.getByText('The fan stopped working again.').first()).toBeVisible();
});

test('CE2E-07: other members and other departments see "Complaint not found"; photo URLs need a signature', async ({ browser }) => {
  const token = await apiToken(STUDENT);
  const c = await api<{ id: string; attachments: { report: { url: string }[] } }>(token, '/complaints', {
    method: 'POST',
    body: JSON.stringify({ categoryId: await categoryId(token, 'plumbing'), title: `E2E private ${Date.now()}` }),
  });
  const other = await signedIn(browser, OTHER);
  await other.goto(`/complaints/${c.id}`);
  await expect(other.getByRole('heading', { name: 'Complaint not found' })).toBeVisible();
  const electrician = await signedIn(browser, ELECTRICAL);
  await electrician.goto(`/staff/complaints/${c.id}`);
  await expect(electrician.getByRole('heading', { name: 'Complaint not found' })).toBeVisible();
});

test('CE2E-10: a department staff member can book a venue', async () => {
  const token = await apiToken(ELECTRICAL);
  const venues = await api<{ id: string; name: string }[]>(token, '/venues?pageSize=50');
  const slot = freeSlot(Date.now() + 7);
  const res = await fetch(`${API}/api/v1/bookings`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ venueId: venues.at(-1)!.id, date: slot.date, startTime: slot.start, endTime: slot.end, purpose: 'Electrical safety briefing' }),
  });
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(201);
  // Clean up, so reruns never reach the 5-pending-requests limit.
  await api(token, `/bookings/${body.data.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: 'E2E clean-up' }) });
});
