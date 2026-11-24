import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, devices } from 'playwright';
import { serve } from './lab.mjs';
import { root } from './lab-core.mjs';

const output = resolve(root, '.lab-output/browser/oxygen');
mkdirSync(output, { recursive: true });
const externalOrigin = process.env.OXYGEN_LAB_URL;
const server = externalOrigin ? null : await serve({ port: 0 });
const url = externalOrigin || `http://127.0.0.1:${server.address().port}/`;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const browser = await chromium.launch({
  executablePath,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
}).catch(error => { server?.close(); throw error; });

const instruments = ['stand', 'tube', 'lamp', 'pipe', 'tank', 'jar'];
const keywords = [...'查装定点收离熄'];
const groups = [
  [[/热毛巾/, /试管底部/]],
  [[/纸槽/, /试管底部/], [/试管口/, /抬高/], [/纸槽/, /抽出/], [/棉花/, /试管口/]],
  [[/橡胶塞/, /试管口/], [/试管口/, /向下/], [/试管|铁夹/, /高度|外焰/], [/导管/, /水面下|水槽/]],
  [[/火柴/, /擦火/], [/燃着的火柴/, /灯芯/], [/酒精灯/, /试管中部/], [/酒精灯/, /装药一端/]],
  [[/盛水容器/, /集气瓶口/], [/玻璃片/, /瓶口/], [/盖好玻璃片的集气瓶/, /倒置/],
    [/玻璃片/, /水槽底/], [/导管/, /倒置的集气瓶口/], [/玻璃片/, /水中的集气瓶口/], [/集气瓶/, /桌面|台面/]],
  [[/导管/, /水面上方/]],
  [[/灯帽/, /酒精灯/]]
];

async function point(locator) {
  const box = await locator.boundingBox();
  assert(box, `${locator} needs a visible bounding box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

async function checkOxygen(phone) {
  const device = phone ? { ...devices['iPhone 13'], browserName: undefined } : { viewport: { width: 1440, height: 900 } };
  const page = await browser.newPage({ ...device, reducedMotion: 'reduce' });
  const name = phone ? 'mobile' : 'desktop';
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) errors.push(`${response.status()} ${response.url()}`);
  });
  const lab = id => page.locator(`[data-lab="${id}"]`);
  const rootEl = page.locator('#oxygen-lab-3d');
  const list = lab('procedure');
  const current = list.locator('[aria-current="step"] .step-label');
  const source = page.locator('[data-action="source"]');
  const destination = page.locator('[data-action="destination"]');
  const sourceNamed = name => source.and(page.getByRole('button', { name }));
  const destinationNamed = name => destination.and(page.getByRole('button', { name }));
  const actionStatus = page.locator('.lab-action-hint [role="status"]');
  const act = locator => phone ? locator.tap() : locator.click();
  const photo = label => page.screenshot({ path: resolve(output, `${name}-${label}.png`), fullPage: true });
  const complete = list.locator('[data-step-state="complete"]');
  const canvas = lab('canvas');
  const scene = label => canvas.screenshot({ path: resolve(output, `${name}-${label}.png`), scale: 'css',
    style: '.lab-overlay { visibility: hidden !important; }' });

  async function markersReady() {
    await destination.waitFor();
    await page.waitForFunction(() => {
      const from = document.querySelector('[data-action="source"]');
      const to = document.querySelector('[data-action="destination"]');
      if (!from.style.left || !to.style.left || from.hidden || to.hidden) return false;
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      return Math.hypot(a.x + a.width / 2 - b.x - b.width / 2, a.y + a.height / 2 - b.y - b.height / 2) >= 48;
    });
  }

  async function transfer() {
    await markersReady();
    if (phone) {
      await act(source);
      assert.equal(await source.getAttribute('aria-pressed'), 'true');
      await act(destination);
    } else {
      await drag(page, await point(source), await point(destination));
    }
  }

  try {
    await page.goto(url);
    const standSlot = page.locator('[data-slot="stand"]');
    await standSlot.waitFor();
    assert.equal(await lab('assembly-count').textContent(), '0 / 6');
    assert(await page.locator('[data-instrument="tube"]').isDisabled());
    assert.equal(await rootEl.getAttribute('data-mode'), 'assembly');
    await act(standSlot);
    assert.equal(await lab('assembly-count').textContent(), '0 / 6');
    assert.match(await lab('note-text').textContent(), /先选中/);

    for (const [index, id] of instruments.entries()) {
      const pick = page.locator(`[data-instrument="${id}"]`);
      const slot = page.locator(`[data-slot="${id}"]`);
      await slot.waitFor();
      if (phone) { await act(pick); await act(slot); }
      else await drag(page, await point(pick), await point(slot));
      assert.equal(await lab('assembly-count').textContent(), `${index + 1} / 6`);
    }
    assert.equal(await rootEl.getAttribute('data-mode'), 'demo');
    assert.deepEqual((await list.locator('.step-label').allTextContents()).map(text => text.trim()[0]), keywords);
    await sourceNamed(/热毛巾/).waitFor();
    await markersReady();
    const before = await scene('assembled');
    await act(destination);
    assert(await sourceNamed(/热毛巾/).isVisible());
    assert.equal(await source.getAttribute('aria-pressed'), 'false');
    if (!phone) {
      const box = await canvas.boundingBox();
      await drag(page, await point(source), { x: box.x + 10, y: box.y + 10 });
      assert(await sourceNamed(/热毛巾/).isVisible());
      assert.equal(await complete.count(), 0);
    }
    await page.evaluate(() => {
      const overlay = document.querySelector('[data-lab="interactions"]');
      const alert = overlay.querySelector('.lab-action-hint [role="status"]');
      window.oxygenObservations = [];
      new MutationObserver(() => {
        if (overlay.dataset.kind === 'observe') window.oxygenObservations.push(alert.textContent);
      })
        .observe(alert, { childList: true, subtree: true, characterData: true });
    });

    for (const [index, operations] of groups.entries()) {
      for (const [operation, [sourceLabel, targetLabel]] of operations.entries()) {
        await sourceNamed(sourceLabel).waitFor();
        await destinationNamed(targetLabel).waitFor();
        assert.equal((await current.textContent()).trim()[0], keywords[index]);
        assert.equal(await complete.count(), index);
        assert.match(await destination.getAttribute('title'), targetLabel);
        assert(await lab('play').isHidden());
        if (index === 3 && operation === 1) await scene('struck-match');
        if (index === 3 && operation === 3) {
          assert((await page.evaluate(() => window.oxygenObservations)).some(message => /酒精灯.*来回移动.*均匀受热/.test(message)));
        }
        if (index === 4 && operation === 2) await scene('water-filled-and-covered');
        if (index === 4 && operation === 4) {
          assert((await page.evaluate(() => window.oxygenObservations)).some(message => /气泡.*连续.*均匀/.test(message)));
          await scene('jar-in-water');
        }
        if (index === 4 && operation === 5) {
          assert((await page.evaluate(() => window.oxygenObservations)).some(message => /排出.*水|水位.*降/.test(message)));
        }
        if (index === 5 && operation === 0) await scene('jar-upright-on-table');
        await transfer();
      }
    }

    await lab('play').waitFor();
    assert.equal(await complete.count(), 7);
    assert(await current.count() === 0);
    assert(await source.isHidden());
    assert(await lab('verify-oxygen').isVisible());
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const after = await scene('result');
    const pixels = await page.evaluate(async ([a, b]) => {
      async function decode(data) {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
        const buffer = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d');
        buffer.drawImage(bitmap, 0, 0);
        return buffer.getImageData(0, 0, bitmap.width, bitmap.height).data;
      }
      const [previous, next] = await Promise.all([decode(a), decode(b)]);
      let changed = 0;
      const tones = new Set();
      for (let i = 0; i < next.length; i += 4) {
        tones.add(`${next[i] >> 4},${next[i + 1] >> 4},${next[i + 2] >> 4}`);
        if (Math.abs(next[i] - previous[i]) + Math.abs(next[i + 1] - previous[i + 1]) + Math.abs(next[i + 2] - previous[i + 2]) > 35) changed++;
      }
      return { tones: tones.size, changed };
    }, [before, after].map(image => image.toString('base64')));
    assert(pixels.tones > 12 && pixels.changed > 75, `${name}: ${JSON.stringify(pixels)}`);
    await photo('complete');

    await act(lab('verify-oxygen'));
    await sourceNamed(/玻璃片/).waitFor();
    await transfer();
    await sourceNamed(/木条/).waitFor();
    await transfer();
    await lab('play').waitFor();
    assert.equal(await complete.count(), 7);
    assert.match(await actionStatus.textContent(), /复燃/);
    await photo('oxygen-verified');

    await act(lab('play'));
    await sourceNamed(/热毛巾/).waitFor();
    assert.equal(await lab('assembly-count').textContent(), '6 / 6');
    assert.equal(await complete.count(), 0);
    assert.equal((await current.textContent()).trim()[0], '查');
    await act(lab('reset-assembly'));
    await standSlot.waitFor();
    assert.equal(await lab('assembly-count').textContent(), '0 / 6');
    assert.equal(await rootEl.getAttribute('data-mode'), 'assembly');
    assert(await source.isHidden());
    assert.deepEqual(errors, []);
    console.log(`Oxygen ${name}: seven steps, optional verification, and both resets passed.`);
  } finally {
    await page.close();
  }
}

try {
  await checkOxygen(false);
  await checkOxygen(true);
  console.log(`Screenshots: ${output}`);
} finally {
  await browser.close();
  server?.close();
}
