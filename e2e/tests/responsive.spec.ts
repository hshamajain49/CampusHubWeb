// E2E-10 (responsive) — runs on the webkit-mobile and chromium-tablet projects.
import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { FACULTY, STUDENT, apiToken, cleanE2eComplaints } from './helpers';

test.beforeAll(cleanE2eComplaints);

test('E2E-10: member screens fit the viewport without horizontal scroll', async ({ page }) => {
  const token = await apiToken(STUDENT);
  await page.addInitScript((t) => localStorage.setItem('campushub.session', t), token);
  for (const path of ['/dashboard', '/venues', '/bookings', '/bookings/history', '/profile', '/notifications', '/complaints', '/complaints/new']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(sw, `${path} scrollWidth`).toBeLessThanOrEqual(cw + 1);
  }
  await page.goto('/venues');
  const filters = page.getByRole('button', { name: /^Filters/ });
  if (await filters.isVisible()) {
    await filters.click();
    await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible();
  }
});

test('CE2E-08: file a complaint with a photo on a phone; the lightbox opens full screen; actions stay visible', async ({ page }) => {
  // Faculty files here, so no account exceeds the 10-per-hour complaint limit (C02) within one suite run.
  const token = await apiToken(FACULTY);
  await page.addInitScript((t) => localStorage.setItem('campushub.session', t), token);
  const jpeg = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#cf9c7c' } }).jpeg().toBuffer();
  await page.goto('/complaints/new');
  await page.getByRole('radio', { name: /^Furniture/ }).click();
  await page.getByLabel('Title').fill(`Mobile E2E chair ${Date.now()}`);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Add photos/ }).click();
  await (await chooser).setFiles({ name: 'chair.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await expect(page.getByText(/^1\/3/)).toBeVisible();
  const submit = page.getByRole('button', { name: 'Submit complaint' });
  await expect(submit).toBeInViewport(); // sticky submit bar on phones
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText('Complaint submitted!')).toBeVisible();
  await expect(page.getByRole('button', { name: /Withdraw complaint/ }).last()).toBeInViewport(); // sticky action bar
  await page.getByRole('button', { name: 'Open photo 1 of 1' }).click();
  const viewer = page.getByRole('dialog');
  await expect(viewer).toBeVisible();
  const vp = page.viewportSize()!;
  if (vp.width < 768) {
    // Full screen below md (§16.5); inset on larger screens.
    const box = await viewer.boundingBox();
    expect(Math.round(box!.width)).toBeGreaterThanOrEqual(vp.width - 1);
  }
  await page.getByRole('button', { name: 'Close photo viewer' }).click();
  await expect(viewer).toBeHidden();
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw).toBeLessThanOrEqual(cw + 1);
});
