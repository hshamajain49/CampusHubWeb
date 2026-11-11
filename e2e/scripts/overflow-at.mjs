// Lists elements extending past the viewport. Usage: node overflow-at.mjs <url> <width>
import { chromium } from '@playwright/test';
const [url, w] = [process.argv[2], Number(process.argv[3] ?? 320)];
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: w, height: 800 } })).newPage();
await p.goto(url, { waitUntil: 'networkidle' });
await p.waitForTimeout(400);
console.log(JSON.stringify(await p.evaluate(() => {
  const W = document.documentElement.clientWidth;
  const clipped = (el) => { for (let a = el.parentElement; a; a = a.parentElement) { const s = getComputedStyle(a); if (/(hidden|clip|auto|scroll)/.test(s.overflowX)) return true; } return false; };
  return [...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > W + 1 && !clipped(el)).slice(0, 8)
    .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent || '').trim().slice(0, 40)}" right=${Math.round(el.getBoundingClientRect().right)} cls=${String(el.className).slice(0, 70)}`);
}), null, 1));
await b.close();
