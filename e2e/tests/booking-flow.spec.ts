// E2E-01 (instant booking + FIFO queue), E2E-05 (overlaps queue), E2E-09 (authorization) — docs/BOOKINGS.md.
import { expect, test } from '@playwright/test';
import { ADMIN, FACULTY, STUDENT, api, apiToken, cleanE2eBookings, freeSlot, signInUi } from './helpers';

test.beforeAll(cleanE2eBookings);

test('E2E-01: student books instantly, faculty queues, student cancels, faculty gets the slot automatically', async ({ browser }) => {
  const studentToken = await apiToken(STUDENT);
  const facultyToken = await apiToken(FACULTY);
  const venues = await api<{ id: string; name: string }[]>(studentToken, '/venues?pageSize=50');
  const venue = venues.find((v) => v.name === 'Seminar Hall A') ?? venues[0]!;
  const slot = freeSlot();
  const purpose = `E2E seminar ${Date.now()}`;
  const newBooking = `/bookings/new?venueId=${venue.id}&date=${slot.date}&start=${slot.start}&end=${slot.end}`;

  // 1–4. Student signs in, checks the venue, books a free time: confirmed instantly, no approval.
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

  await student.goto(newBooking);
  await expect(student.getByText('This time is free: it will be confirmed instantly')).toBeVisible();
  await student.getByLabel('USN / Faculty ID').fill('1rv22cs045');
  await student.getByLabel('Purpose of booking').fill(purpose);
  await student.getByLabel(/Approximate attendees/).fill('40');
  await student.getByRole('button', { name: 'Book now' }).click();
  await expect(student.getByRole('heading', { name: 'Booking confirmed!' })).toBeVisible();
  const reference = (await student.locator('p.font-mono').first().textContent())!.trim();
  expect(reference).toMatch(/^BK-\d{4}-\d{6,}$/);
  await expect(student.getByText('1RV22CS045')).toBeVisible(); // stored upper case

  // 5–6. Faculty asks for the same time: the form says it will queue, and the request joins the queue as #1.
  const facultyCtx = await browser.newContext();
  const faculty = await facultyCtx.newPage();
  await signInUi(faculty, FACULTY);
  await expect(faculty).toHaveURL(/\/dashboard/);
  await faculty.goto(newBooking);
  await expect(faculty.getByText(/You'll join the queue as #1/)).toBeVisible();
  await faculty.getByLabel('USN / Faculty ID').fill('FAC-1024');
  await faculty.getByLabel('Purpose of booking').fill(`${purpose} (faculty)`);
  await faculty.getByRole('button', { name: 'Join the queue' }).click();
  await expect(faculty.getByRole('heading', { name: "You're #1 in the queue" })).toBeVisible();
  const queuedUrl = faculty.url().replace(/\/submitted$/, '');

  // 7. The admin sees both without approving anything; the old approvals page lands on the queue.
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await signInUi(admin, ADMIN, '/admin/login');
  await expect(admin).toHaveURL(/\/admin\/dashboard/);
  await expect(admin.getByRole('link', { name: /Approvals/ })).toHaveCount(0);
  await admin.goto('/admin/approvals');
  await expect(admin).toHaveURL(/\/admin\/bookings\?status=queued/);
  await admin.getByRole('searchbox', { name: 'Search bookings' }).fill(reference);
  await admin.getByRole('radio', { name: /^All/ }).click();
  await expect(admin.getByRole('link', { name: reference })).toBeVisible();
  await admin.getByRole('link', { name: reference }).click();
  await expect(admin.getByText('FAC-1024')).toHaveCount(0);
  await expect(admin.getByText('1RV22CS045').first()).toBeVisible();
  await expect(admin.getByRole('button', { name: /^Approve/ })).toHaveCount(0);

  // 8–9. Student sees the confirmation, downloads the PDF, then cancels.
  await student.getByRole('link', { name: 'View booking' }).click();
  await expect(student.getByText('Your booking is confirmed.')).toBeVisible();
  await expect(student.getByText(/Booked and confirmed by you/)).toBeVisible();
  const [download] = await Promise.all([student.waitForEvent('download'), student.getByRole('button', { name: 'Download confirmation' }).first().click()]);
  expect(download.suggestedFilename()).toBe(`booking-confirmation-${reference}.pdf`);
  const file = await download.path();
  const head = (await import('node:fs')).readFileSync(file!).subarray(0, 5).toString();
  expect(head).toBe('%PDF-');
  await student.getByRole('button', { name: 'Cancel booking' }).first().click();
  await student.getByRole('alertdialog').getByRole('button', { name: 'Cancel booking' }).click();
  await expect(student.getByText('Booking cancelled.')).toBeVisible();

  // 10–11. Faculty was first in line: confirmed automatically, with an in-app notification.
  await faculty.goto(queuedUrl);
  await expect(faculty.getByText('Your booking is confirmed.')).toBeVisible();
  await expect(faculty.getByText(/next in the queue/)).toBeVisible();
  await expect(faculty.getByText('Slot freed up: confirmed')).toBeVisible();
  await faculty.goto('/notifications');
  await expect(faculty.getByText('Good news: your booking is confirmed').first()).toBeVisible();

  // Clean up so reruns never reach the upcoming-bookings limit.
  await api(facultyToken, `/bookings/${queuedUrl.split('/').pop()}/cancel`, { method: 'POST', body: JSON.stringify({}) });
  await studentCtx.close();
  await facultyCtx.close();
  await adminCtx.close();
});

test('E2E-05: an overlapping request would queue; back-to-back slots are free', async ({ page }) => {
  const studentToken = await apiToken(STUDENT);
  const venues = await api<{ id: string; name: string }[]>(studentToken, '/venues?pageSize=50');
  const venue = venues.find((v) => v.name === 'Computer Lab 2') ?? venues[0]!;
  const slot = freeSlot(Date.now() + 7_777);
  const created = await api<{ id: string; status: string }>(studentToken, '/bookings', {
    method: 'POST',
    body: JSON.stringify({ venueId: venue.id, date: slot.date, startTime: slot.start, endTime: slot.end, purpose: 'E2E conflict anchor', idNumber: '1RV22CS045' }),
  });
  expect(created?.status).toBe('confirmed');

  await signInUi(page, FACULTY);
  await expect(page).toHaveURL(/\/dashboard/);
  const overlapStart = `${String(Number(slot.start.slice(0, 2)) + 1).padStart(2, '0')}:00`;
  const overlapEnd = `${String(Number(slot.end.slice(0, 2)) + 1).padStart(2, '0')}:00`;
  await page.goto(`/bookings/new?venueId=${venue.id}&date=${slot.date}&start=${overlapStart}&end=${overlapEnd}`);
  await expect(page.getByText(/Already booked .*You'll join the queue as #1/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Join the queue' })).toBeEnabled();

  // Back-to-back (starts exactly when the anchor ends) is free.
  await page.goto(`/bookings/new?venueId=${venue.id}&date=${slot.date}&start=${slot.end}&end=${overlapEnd}`);
  await expect(page.getByText('This time is free: it will be confirmed instantly')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Book now' })).toBeEnabled();

  // Clean up: cancel the anchor so the upcoming-bookings limit isn't consumed across runs.
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
