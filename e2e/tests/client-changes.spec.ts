// Client change list (docs/BOOKINGS.md, docs/ACCOUNTS.md): multi-day bookings, "venue booked" announcements,
// cancellation details, Super Admin booking, the suggestion box and permanent account deletion. Needs `npm run local`.
import { expect, test } from '@playwright/test';
import pg from 'pg';
import { ADMIN, API, FACULTY, STUDENT, api, apiToken, cleanE2eBookings, freeSlot, signInUi } from './helpers';

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function sql(text: string, params: unknown[] = []) {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await db.query(text, params);
  } finally {
    await db.end();
  }
}

test.beforeAll(async () => {
  await cleanE2eBookings();
  await sql(`delete from suggestions where subject like 'E2E %'`);
});

async function venueNamed(token: string, name: string) {
  const venues = await api<{ id: string; name: string }[]>(token, '/venues?pageSize=50');
  return venues.find((v) => v.name === name) ?? venues[0]!;
}

test('E2E-12: a three-day booking is confirmed in one go; everyone hears the venue is booked; the cancellation explains what happened', async ({ browser }) => {
  const studentToken = await apiToken(STUDENT);
  const venue = await venueNamed(studentToken, 'Seminar Hall A');
  const slot = freeSlot(Date.now() + 31_337);
  const last = addDays(slot.date, 2);
  const purpose = `E2E workshop ${Date.now()}`;

  const student = await (await browser.newContext()).newPage();
  await signInUi(student, STUDENT);
  await expect(student).toHaveURL(/\/dashboard/);
  await student.goto(`/bookings/new?venueId=${venue.id}&date=${slot.date}&endDate=${last}&start=${slot.start}&end=${slot.end}`);
  await expect(student.getByText(/^3 days · /)).toBeVisible();
  await expect(student.getByRole('list', { name: 'Availability by day' }).getByRole('listitem')).toHaveCount(3);
  await expect(student.getByText('Free on all 3 days: it will be confirmed instantly')).toBeVisible();
  await student.getByLabel('USN / Faculty ID').fill('1RV22CS045');
  await student.getByLabel('Purpose of booking').fill(purpose);
  await student.getByRole('button', { name: 'Book now' }).click();
  await expect(student.getByRole('heading', { name: 'Booking confirmed!' })).toBeVisible();
  const id = student.url().split('/').slice(-2)[0]!;

  // Every other member is told the venue is booked (in-app, linking to the venue).
  const faculty = await (await browser.newContext()).newPage();
  await signInUi(faculty, FACULTY);
  await expect(faculty).toHaveURL(/\/dashboard/);
  await faculty.goto('/notifications');
  await expect(faculty.getByText(`${venue.name} is booked`).first()).toBeVisible();

  // Cancelling: the member's notification names the venue, the status and what happened to the time.
  await api(studentToken, `/bookings/${id}/cancel`, { method: 'POST', body: JSON.stringify({}) });
  await student.goto('/notifications');
  await expect(student.getByText('Booking cancelled').first()).toBeVisible();
  await expect(student.getByText(/Status: Cancelled\. The time is available again/).first()).toBeVisible();
  await faculty.reload();
  await expect(faculty.getByText(`${venue.name} is available again`).first()).toBeVisible();
});

test('E2E-13: the Super Admin books a venue from the admin area', async ({ page }) => {
  const venue = await venueNamed(await apiToken(STUDENT), 'Computer Lab 2');
  const slot = freeSlot(Date.now() + 54_321);
  await signInUi(page, ADMIN, '/admin/login');
  await expect(page).toHaveURL(/\/admin\/dashboard/);
  await page.getByRole('link', { name: 'Book a venue' }).click();
  await expect(page).toHaveURL(/\/admin\/book$/);
  await page.goto(`/admin/book?venueId=${venue.id}&date=${slot.date}&start=${slot.start}&end=${slot.end}`);
  await expect(page.getByText('This time is free: it will be confirmed instantly')).toBeVisible();
  await page.getByLabel('USN / Faculty ID').fill('ADM-0001');
  await page.getByLabel('Purpose of booking').fill(`E2E admin meeting ${Date.now()}`);
  await page.getByRole('button', { name: 'Book now' }).click();
  await expect(page.getByRole('heading', { name: 'Booking confirmed!' })).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/my-bookings\/[0-9a-f-]+\/submitted$/);
  const id = page.url().split('/').slice(-2)[0]!;

  await page.getByRole('link', { name: 'My bookings' }).first().click();
  await expect(page).toHaveURL(/\/admin\/my-bookings$/);
  await page.goto(`/admin/my-bookings/${id}`);
  await page.getByRole('button', { name: 'Cancel booking' }).first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel booking' }).click();
  await expect(page.getByText('Booking cancelled.')).toBeVisible();
});

test('E2E-14: suggestion box: a member sends an idea, the admin replies, the member reads the reply', async ({ browser }) => {
  const subject = `E2E idea ${Date.now()}`;
  const student = await (await browser.newContext()).newPage();
  await signInUi(student, STUDENT);
  await expect(student).toHaveURL(/\/dashboard/);
  await student.getByRole('link', { name: /Suggestion box/ }).first().click();
  await expect(student).toHaveURL(/\/suggestions$/);
  await student.getByRole('button', { name: 'Send suggestion' }).click();
  await expect(student.getByText('Subject must be 3–120 characters')).toBeVisible();
  await student.getByLabel('Subject').fill(subject);
  await student.getByLabel('Your suggestion').fill('Please add more charging points in the library reading room.');
  await student.getByRole('button', { name: 'Send suggestion' }).click();
  await expect(student.getByText('Thanks! Your suggestion was sent.')).toBeVisible();
  await expect(student.getByRole('heading', { name: subject })).toBeVisible();

  const admin = await (await browser.newContext()).newPage();
  await signInUi(admin, ADMIN, '/admin/login');
  await expect(admin).toHaveURL(/\/admin\/dashboard/);
  await admin.getByRole('link', { name: /Suggestion box/ }).click();
  await admin.getByRole('searchbox', { name: 'Search suggestions' }).fill(subject);
  const card = admin.getByRole('listitem').filter({ has: admin.getByRole('heading', { name: subject }) });
  await expect(card).toHaveCount(1);
  await card.getByRole('button', { name: 'Reply' }).click();
  await admin.getByRole('dialog').getByLabel(/Reply/).fill('Good idea: four more sockets are going in next week.');
  await admin.getByRole('dialog').getByRole('button', { name: 'Save and mark reviewed' }).click();
  await expect(admin.getByText('Reply saved.')).toBeVisible();
  await expect(card.getByText('Reviewed')).toBeVisible();

  await student.reload();
  await expect(student.getByText('Good idea: four more sockets are going in next week.')).toBeVisible();
});

test('E2E-15: a member deletes their account permanently', async ({ page }) => {
  const who = { email: `e2e.delete.${Date.now()}@demo.edu`, password: 'Delete12345' };
  const res = await fetch(`${API}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: process.env.E2E_BASE_URL ?? 'http://localhost:5173' },
    body: JSON.stringify({ fullName: 'E2E Delete Me', ...who }),
  });
  expect(res.status, 'register').toBe(201);

  await signInUi(page, who);
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Delete account' }).click();
  const dlg = page.getByRole('alertdialog');
  await expect(dlg.getByRole('button', { name: 'Delete my account' })).toBeDisabled();
  await dlg.getByLabel('Your password').fill('wrong-password-1');
  await dlg.getByLabel('Type DELETE to confirm').fill('DELETE');
  await dlg.getByRole('button', { name: 'Delete my account' }).click();
  await expect(dlg.getByRole('alert')).toBeVisible(); // wrong password: the dialog stays open with the message
  await dlg.getByLabel('Your password').fill(who.password);
  await dlg.getByRole('button', { name: 'Delete my account' }).click();
  await expect(page).toHaveURL(/\/login\?reason=account_deleted/);
  await expect(page.getByText('Your account and its data were deleted.')).toBeVisible();

  await signInUi(page, who);
  await expect(page.getByRole('alert').filter({ hasText: 'Incorrect email or password.' })).toBeVisible();
});
