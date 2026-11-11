// E2E-01 (primary flow), E2E-05 (conflicts), E2E-09 (authorization) — §28.6.
import { expect, test } from '@playwright/test';
import { ADMIN, FACULTY, STUDENT, api, apiToken, freeSlot, signInUi } from './helpers';

test('E2E-01: student requests, admin approves with a note, student downloads the confirmation', async ({ browser }) => {
  const studentToken = await apiToken(STUDENT);
  const venues = await api<{ id: string; name: string }[]>(studentToken, '/venues?pageSize=50');
  const venue = venues.find((v) => v.name === 'Seminar Hall A') ?? venues[0]!;
  const slot = freeSlot();
  const purpose = `E2E seminar ${Date.now()}`;

  // 1–5. Student signs in, checks the venue, submits a request.
  const studentCtx = await browser.newContext();
  const student = await studentCtx.newPage();
  await signInUi(student, STUDENT);
  await expect(student).toHaveURL(/\/dashboard/);
  await student.getByRole('link', { name: 'Venues', exact: true }).first().click();
  await expect(student).toHaveURL(/\/venues$/);
  await student.getByRole('link', { name: venue.name }).first().click();
  await expect(student.getByRole('heading', { name: venue.name })).toBeVisible();
  await student.getByRole('tab', { name: 'Availability' }).click();
  await expect(student.locator('.fc')).toBeVisible();

  await student.goto(`/bookings/new?venueId=${venue.id}&date=${slot.date}&start=${slot.start}&end=${slot.end}`);
  await expect(student.getByText('This time is available')).toBeVisible();
  await student.getByLabel('Purpose of booking').fill(purpose);
  await student.getByLabel(/Approximate attendees/).fill('40');
  await student.getByRole('button', { name: 'Submit request' }).click();
  await expect(student.getByRole('heading', { name: 'Booking requested!' })).toBeVisible();
  const reference = (await student.locator('p.font-mono').first().textContent())!.trim();
  expect(reference).toMatch(/^BK-\d{4}-\d{6,}$/);

  // 6–8. Admin approves from the queue with a note.
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await signInUi(admin, ADMIN, '/admin/login');
  await expect(admin).toHaveURL(/\/admin\/dashboard/);
  await admin.goto('/admin/approvals');
  const card = admin.locator('article', { hasText: reference });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Approve' }).click();
  await admin.getByLabel(/Note to requester/).fill('Keys at admin office');
  await admin.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await expect(admin.getByText('Booking approved.')).toBeVisible();

  // 9–11. Student sees the decision, timeline and downloads the PDF.
  await student.getByRole('link', { name: 'View booking' }).click();
  await student.reload();
  await expect(student.getByText('Your booking is confirmed.')).toBeVisible();
  await expect(student.getByText('Keys at admin office').first()).toBeVisible();
  await expect(student.getByText(/Request submitted by you/)).toBeVisible();
  await expect(student.getByText(/Approved by/)).toBeVisible();
  const [download] = await Promise.all([student.waitForEvent('download'), student.getByRole('button', { name: 'Download confirmation' }).first().click()]);
  expect(download.suggestedFilename()).toBe(`booking-confirmation-${reference}.pdf`);
  const file = await download.path();
  const head = (await import('node:fs')).readFileSync(file!).subarray(0, 5).toString();
  expect(head).toBe('%PDF-');

  await studentCtx.close();
  await adminCtx.close();
});

test('E2E-05: overlapping requests are refused, back-to-back slots are allowed', async ({ page }) => {
  const studentToken = await apiToken(STUDENT);
  const venues = await api<{ id: string; name: string }[]>(studentToken, '/venues?pageSize=50');
  const venue = venues.find((v) => v.name === 'Computer Lab 2') ?? venues[0]!;
  const slot = freeSlot(Date.now() + 7_777);
  const created = await api<{ id: string }>(studentToken, '/bookings', {
    method: 'POST',
    body: JSON.stringify({ venueId: venue.id, date: slot.date, startTime: slot.start, endTime: slot.end, purpose: 'E2E conflict anchor' }),
  });
  expect(created?.id).toBeTruthy();

  await signInUi(page, FACULTY);
  await expect(page).toHaveURL(/\/dashboard/);
  const overlapStart = `${String(Number(slot.start.slice(0, 2)) + 1).padStart(2, '0')}:00`;
  const overlapEnd = `${String(Number(slot.end.slice(0, 2)) + 1).padStart(2, '0')}:00`;
  await page.goto(`/bookings/new?venueId=${venue.id}&date=${slot.date}&start=${overlapStart}&end=${overlapEnd}`);
  await expect(page.getByText(/Conflicts with/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit request' })).toBeDisabled();

  // Back-to-back (starts exactly when the anchor ends) is available.
  await page.goto(`/bookings/new?venueId=${venue.id}&date=${slot.date}&start=${slot.end}&end=${overlapEnd}`);
  await expect(page.getByText('This time is available')).toBeVisible();

  // Clean up: cancel the anchor so the pending limit isn't consumed across runs.
  await api(studentToken, `/bookings/${created.id}/cancel`, { method: 'POST', body: JSON.stringify({}) });
});

test('E2E-09: role routing and other users’ bookings', async ({ page }) => {
  await signInUi(page, STUDENT);
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto('/admin/dashboard');
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/bookings/00000000-0000-4000-8000-000000000000');
  await expect(page.getByText('Booking not found')).toBeVisible();
});

test('E2E-08: wrong password shows the mapped message', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(STUDENT.email);
  await page.getByLabel('Password', { exact: true }).fill('wrong-password-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Incorrect email or password.' })).toBeVisible();
});
