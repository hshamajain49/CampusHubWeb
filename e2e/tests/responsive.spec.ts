// E2E-10 (responsive) — runs on the webkit-mobile and chromium-tablet projects.
import { expect, test } from '@playwright/test';
import { STUDENT, apiToken } from './helpers';

test('E2E-10: member screens fit the viewport without horizontal scroll', async ({ page }) => {
  const token = await apiToken(STUDENT);
  await page.addInitScript((t) => localStorage.setItem('campushub.session', t), token);
  for (const path of ['/dashboard', '/venues', '/bookings', '/bookings/history', '/profile', '/notifications']) {
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
