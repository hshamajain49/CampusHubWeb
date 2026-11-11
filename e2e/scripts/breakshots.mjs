import { chromium } from '@playwright/test';
const out = process.argv[2];
const b = await chromium.launch();
for (const w of [1440, 390, 320]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:5173/dev/break-ui?data=worst', { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${out}/break-${w}.png`, fullPage: true });
  const r = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  console.log(w, JSON.stringify(r), errs.join(' | '));
  await ctx.close();
}
await b.close();
