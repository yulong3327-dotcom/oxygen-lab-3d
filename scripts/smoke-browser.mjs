import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, devices } from 'playwright';
import { serve } from './lab.mjs';
import { root } from './lab-core.mjs';

const server = await serve({ port: 0 });
const origin = `http://127.0.0.1:${server.address().port}`;
const output = resolve(root, '.lab-output/browser');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
}).catch(error => { server.close(); throw error; });

function watch(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) errors.push(`${response.status()} ${response.url()}`); });
  return errors;
}

async function open(page, id) {
  const model = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/stand.glb') && r.ok());
  await page.goto(`${origin}/platform/player.html?id=${id}`);
  await page.locator('#player[data-ready="true"]').waitFor({ timeout: 15000 });
  await model;
}

const step = (page, n) => page.locator(`#player[data-step-index="${n}"]`).waitFor();
const instrument = (page, id) => page.locator(`[data-instrument-id="${id}"]`);

async function canvasCheck(page, name, previous) {
  const scene = page.locator('#scene');
  const shot = await scene.screenshot({ path: resolve(output, `${name}.png`), scale: 'css' });
  const dimensions = await scene.boundingBox();
  const result = await page.evaluate(async ({ current, previous }) => {
    async function pixels(encoded) {
      const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${encoded}`)).blob());
      const canvas = new OffscreenCanvas(img.width, img.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return { rgba: ctx.getImageData(0, 0, img.width, img.height).data, width: img.width, height: img.height };
    }
    const image = await pixels(current);
    const old = previous ? (await pixels(previous)).rgba : null;
    const tones = new Set();
    let dark = 0;
    let delta = 0;
    for (let p = 0; p < image.rgba.length; p += 4) {
      const [r, g, b] = image.rgba.subarray(p, p + 3);
      tones.add(`${r >> 4},${g >> 4},${b >> 4}`);
      if (r < 150 && g < 150 && b < 150) dark++;
      if (old && Math.abs(r - old[p]) + Math.abs(g - old[p + 1]) + Math.abs(b - old[p + 2]) > 70) delta++;
    }
    return { dark, delta, tones: tones.size };
  }, { current: shot.toString('base64'), previous: previous?.toString('base64') });
  assert(dimensions.width > 240 && dimensions.height > 200);
  assert(result.tones >= 12 && result.dark > 300, `${name}: expected a visible instrument, got ${JSON.stringify(result)}`);
  if (previous) assert(result.delta > 500, `${name}: expected a visible movement, got ${JSON.stringify(result)}`);
  return shot;
}

try {
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const desktopErrors = watch(desktop);
  await desktop.goto(`${origin}/platform/`);
  await desktop.getByRole('link', { name: /高锰酸钾制氧气/ }).click();
  await desktop.locator('#oxygen-lab-3d').waitFor();
  await desktop.getByRole('link', { name: /全部实验/ }).click();
  await desktop.getByRole('link', { name: /高锰酸钾制氧气/ }).waitFor();
  await open(desktop, 'stand-placement');
  const before = await canvasCheck(desktop, 'desktop-before');
  await instrument(desktop, 'stand-1').click();
  await step(desktop, 1);
  await desktop.locator('#target').click();
  assert.equal(await desktop.locator('#feedback').getAttribute('data-state'), 'wrong');
  await step(desktop, 1);
  const scene = await desktop.locator('#scene').boundingBox();
  const drop = await desktop.locator('#target').boundingBox();
  await desktop.mouse.move(scene.x + scene.width * 0.343, scene.y + scene.height * 0.574);
  await desktop.mouse.down();
  await desktop.mouse.move(drop.x + drop.width / 2, drop.y + drop.height / 2, { steps: 14 });
  await desktop.mouse.up();
  await desktop.locator('#player[data-complete="true"]').waitFor();
  await canvasCheck(desktop, 'desktop-after', before);
  await desktop.locator('#reset-experiment').click();
  await step(desktop, 0);
  await desktop.screenshot({ path: resolve(output, 'desktop-page.png') });
  assert.deepEqual(desktopErrors, []);

  const mobile = await browser.newPage({ ...devices['iPhone 13'], browserName: undefined });
  const mobileErrors = watch(mobile);
  await open(mobile, 'stand-comparison');
  const mobileBefore = await canvasCheck(mobile, 'mobile-before');
  await instrument(mobile, 'stand-1').tap();
  assert.equal(await mobile.locator('#feedback').getAttribute('data-state'), 'wrong');
  await step(mobile, 0);
  await instrument(mobile, 'stand-2').tap();
  await step(mobile, 1);
  await instrument(mobile, 'stand-2').tap();
  await mobile.locator('#target').tap();
  await mobile.locator('#player[data-complete="true"]').waitFor();
  await canvasCheck(mobile, 'mobile-after', mobileBefore);
  await mobile.locator('#reset-experiment').tap();
  await step(mobile, 0);
  await mobile.locator('#demonstrate').tap();
  await step(mobile, 1);
  await mobile.locator('#demonstrate').tap();
  await mobile.locator('#player[data-complete="true"]').waitFor();
  assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await mobile.screenshot({ path: resolve(output, 'mobile-page.png'), fullPage: true });
  assert.deepEqual(mobileErrors, []);
  console.log(`Desktop and mobile checks passed. Screenshots: ${output}`);
} finally {
  await browser.close();
  server.close();
}
