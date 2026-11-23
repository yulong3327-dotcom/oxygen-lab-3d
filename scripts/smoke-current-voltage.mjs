import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, devices } from 'playwright';
import { serve } from './lab.mjs';
import { root } from './lab-core.mjs';

const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const server = process.env.LAB_PREVIEW_ORIGIN ? null : await serve({ port: 0 });
const origin = process.env.LAB_PREVIEW_ORIGIN ?? `http://127.0.0.1:${server.address().port}`;
const output = resolve(root, '.lab-output/current-voltage');
mkdirSync(output, { recursive: true });
const mobile = { ...devices['iPhone 13'], browserName: undefined };
const desktop = { viewport: { width: 1440, height: 900 } };
const hiddenGuides = '.lab-overlay, .lab-target, #step-hint, #bench-feedback { visibility: hidden !important; }';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(edge) ? edge : undefined),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
}).catch(error => { server?.close(); throw error; });

function watch(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => {
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) errors.push(`${response.status()} ${response.url()}`);
  });
  return errors;
}

async function center(element) {
  const box = await element.boundingBox();
  assert(box, `${element} should have a visible bounding box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

async function cancelTouch(page, from, to) {
  const touch = await page.context().newCDPSession(page);
  try {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    for (let i = 1; i <= 8; i++) {
      const x = from.x + (to.x - from.x) * i / 8;
      const y = from.y + (to.y - from.y) * i / 8;
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  } finally {
    await touch.detach();
  }
}

const shot = (page, name) => page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true, scale: 'css' });

async function canvasShot(page, canvas, name, before, { minDelta = 120, threshold = 32 } = {}) {
  const image = await canvas.screenshot({ path: resolve(output, `${name}.png`), style: hiddenGuides, scale: 'css' });
  const result = await page.evaluate(async ({ image, before, threshold }) => {
    async function unpack(encoded) {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${encoded}`)).blob());
      const buffer = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = buffer.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      return { rgba: context.getImageData(0, 0, buffer.width, buffer.height).data, width: bitmap.width, height: bitmap.height };
    }
    const { rgba, width, height } = await unpack(image);
    const old = before ? await unpack(before) : null;
    const allColors = new Set();
    let dark = 0, delta = 0;
    for (let p = 0; p < rgba.length; p += 4) {
      const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
      allColors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
      if (r < 150 && g < 150 && b < 150) dark++;
      if (old && Math.abs(r - old.rgba[p]) + Math.abs(g - old.rgba[p + 1]) + Math.abs(b - old.rgba[p + 2]) > threshold) delta++;
    }
    return { dark, delta, tones: allColors.size, width, height, sameSize: !old || (old.width === width && old.height === height) };
  }, { image: image.toString('base64'), before: before?.toString('base64'), threshold });
  assert(result.width > 240 && result.height > 200 && result.sameSize, `${name}: invalid scene dimensions ${JSON.stringify(result)}`);
  assert(result.tones >= 12 && result.dark > 200, `${name}: expected a visible 3D scene ${JSON.stringify(result)}`);
  if (before) assert(result.delta >= minDelta, `${name}: visible change too small ${JSON.stringify(result)}`);
  console.log(name, JSON.stringify(result));
  return image;
}

async function baseline(phone) {
  const size = phone ? 'mobile' : 'desktop';
  const page = await browser.newPage({ ...(phone ? mobile : desktop), reducedMotion: 'reduce' });
  const errors = watch(page);
  const activate = el => phone ? el.tap() : el.click();
  const element = name => page.locator(`[data-lab="${name}"]`);
  const canvas = element('canvas');
  const replay = element('play');
  const rebuild = element('reset-assembly');
  const source = page.locator('[data-action="source"]');
  const destination = page.locator('[data-action="destination"]');
  const stateCount = () => element('procedure').locator('[data-step-state="complete"]').count();
  const items = ['stand', 'tube', 'lamp', 'pipe', 'tank', 'jar'];
  try {
    await page.goto(`${origin}/`);
    await element('fallback').waitFor({ state: 'hidden', timeout: 20000 });
    assert.equal(await element('assembly-count').textContent(), '0 / 6');
    assert(await page.locator('[data-instrument="tube"]').isDisabled());
    for (const [index, id] of items.entries()) {
      const pick = page.locator(`[data-instrument="${id}"]`);
      const target = page.locator(`[data-slot="${id}"]`);
      await target.waitFor();
      if (phone) {
        await activate(pick);
        await activate(target);
      } else {
        await drag(page, await center(pick), await center(target));
      }
      assert.equal(await element('assembly-count').textContent(), `${index + 1} / 6`);
    }
    assert(await replay.isHidden());
    await canvasShot(page, canvas, `reference-${size}-assembled`);
    await shot(page, `reference-${size}-operation`);

    for (let operation = 0; operation < 30; operation++) {
      if (await stateCount() === 8) break;
      const next = await Promise.race([
        source.waitFor({ timeout: 20000 }).then(() => 'source'),
        replay.waitFor({ timeout: 20000 }).then(() => 'replay')
      ]);
      if (next === 'replay') break;
      await destination.waitFor();
      const before = await source.getAttribute('aria-label');
      const detail = await element('step-detail').textContent();
      if (phone) {
        await activate(source);
        await activate(destination);
      } else {
        await drag(page, await center(source), await center(destination));
      }
      await page.waitForFunction(({ before, detail }) => {
        const marker = document.querySelector('[data-action="source"]');
        return marker.hidden || document.querySelector('[data-lab="play"]').hidden === false
          || marker.getAttribute('aria-label') !== before || document.querySelector('[data-lab="step-detail"]').textContent !== detail;
      }, { before, detail });
    }
    await replay.waitFor({ timeout: 20000 });
    assert.equal(await stateCount(), 8);
    assert.match(await element('step-detail').textContent(), /木条复燃/);
    await shot(page, `reference-${size}-complete`);
    await activate(replay);
    assert.equal(await element('assembly-count').textContent(), '6 / 6');
    await source.waitFor();
    await activate(rebuild);
    assert.equal(await element('assembly-count').textContent(), '0 / 6');
    assert(await source.isHidden());
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    console.log(`Reference ${size}: assembled 6 instruments, completed 8 steps and verified both resets.`);
  } finally {
    await page.close();
  }
}

const assemblyOrder = ['power', 'switch', 'ammeter', 'resistor', 'voltmeter', 'rheostat'];

async function experiment(phone) {
  const size = phone ? 'mobile' : 'desktop';
  const page = await browser.newPage({ ...(phone ? mobile : desktop), reducedMotion: 'reduce' });
  page.setDefaultTimeout(7000);
  const errors = watch(page);
  const activate = el => phone ? el.tap() : el.click();
  const scene = page.locator('#scene');
  const count = page.locator('#assembly-count');
  const feedback = page.locator('#feedback');
  const rebuild = page.locator('#reset-assembly');
  const replay = page.locator('#reset-experiment');
  const check = page.locator('#circuit-check');
  const undo = page.locator('#circuit-undo');
  const lever = page.locator('#circuit-switch');
  const open = page.locator('#circuit-open');
  const stageLever = page.locator('#circuit-switch-marker');
  const stageSlider = page.locator('#circuit-slider-marker');
  const slider = page.locator('#circuit-slider');
  const record = page.locator('#circuit-record');
  const table = page.locator('#circuit-data tbody tr');
  const chart = page.locator('.circuit-graph');
  const wireCount = value => page.locator(`#circuit-overlay[data-wire-count="${value}"]`).waitFor();
  const phase = value => page.locator(`#player[data-phase="${value}"]`).waitFor();
  const step = index => page.locator(`#player[data-step-index="${index}"]`).waitFor();
  const item = id => page.locator(`[data-instrument-id="${id}"]`);
  const target = id => page.locator(`[data-slot="${id}"]`);
  const terminal = id => page.locator(`button[data-terminal="${id}"]`);
  const connect = async (a, b) => {
    const start = terminal(a), end = terminal(b);
    await start.scrollIntoViewIfNeeded();
    await end.scrollIntoViewIfNeeded();
    if (phone) {
      await activate(start);
      assert.equal(await start.getAttribute('aria-pressed'), 'true');
      await activate(end);
    } else {
      await drag(page, await center(start), await center(end));
    }
  };
  const wrong = async reason => {
    assert.equal(await feedback.getAttribute('data-state'), 'wrong');
    if (reason) assert.match(await feedback.textContent(), reason);
  };
  const slide = async value => {
    if (phone) {
      await slider.scrollIntoViewIfNeeded();
      const box = await slider.boundingBox();
      const inset = 8;
      const x = box.x + inset + (box.width - inset * 2) * value / 100;
      await page.touchscreen.tap(x, box.y + box.height / 2);
    } else {
      await slider.press(value === 100 ? 'End' : 'Home');
      if (value !== 100) {
        for (let i = 0; i < value / 10; i++) await slider.press('PageUp');
      }
    }
    const actual = Number(await slider.inputValue());
    assert(Math.abs(actual - value) <= (phone && value % 100 !== 0 ? 2 : 0), `expected slider ${value}, got ${actual}`);
    return actual;
  };

  try {
    await page.goto(`${origin}/platform/player.html?id=current-voltage&mode=guided`);
    await page.locator('#player[data-ready="true"]').waitFor({ timeout: 20000 });
    await phase('assembly');
    assert.equal(await count.textContent(), '0 / 6');
    assert(await item('switch').isDisabled());
    assert(await item('power').isEnabled());
    assert(await replay.isHidden());
    await page.waitForFunction(() => {
      const images = [...document.querySelectorAll('#instruments img')];
      return images.length === 6 && images.every(img => img.complete && img.naturalWidth > 0);
    });
    await shot(page, `${size}-assembly`);
    const empty = await scene.screenshot({ style: hiddenGuides, scale: 'css' });

    await activate(target('power'));
    await wrong(/先选/);
    assert.equal(await count.textContent(), '0 / 6');
    if (phone) {
      await page.evaluate(() => scrollTo(0, 0));
      await cancelTouch(page, await center(item('power')), await center(target('power')));
      assert.equal(await item('power').getAttribute('aria-pressed'), 'false');
    } else {
      const box = await scene.boundingBox();
      await drag(page, await center(item('power')), { x: box.x + box.width - 18, y: box.y + 18 });
      await wrong(/有效位置/);
    }
    assert.equal(await count.textContent(), '0 / 6');

    for (const [index, id] of assemblyOrder.entries()) {
      await target(id).waitFor();
      assert(await item(id).isEnabled());
      if (phone) {
        await activate(item(id));
        assert.equal(await item(id).getAttribute('aria-pressed'), 'true');
        await activate(target(id));
      } else {
        await drag(page, await center(item(id)), await center(target(id)));
      }
      assert.equal(await item(id).getAttribute('data-placed'), '');
      assert.equal(await count.textContent(), `${index + 1} / 6`);
    }
    await phase('operation');
    await step(0);
    const assembled = await canvasShot(page, scene, `${size}-assembled-scene`, empty);
    await shot(page, `${size}-ready-to-wire`);

    const from = terminal('power:p'), to = terminal('power:n');
    await from.scrollIntoViewIfNeeded();
    const buttons = page.locator('button[data-terminal]');
    assert.equal(await buttons.count(), 14);
    for (const element of await buttons.all()) {
      await element.scrollIntoViewIfNeeded();
      const p = await center(element);
      const id = await element.getAttribute('data-terminal');
      const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.dataset.terminal, p);
      assert.equal(hit, id, `terminal ${id} should be reachable at its center`);
    }
    await scene.scrollIntoViewIfNeeded();
    if (phone) {
      await cancelTouch(page, await center(from), await center(to));
    } else {
      await activate(from);
      await page.keyboard.press('Escape');
    }
    assert.equal(await from.getAttribute('aria-pressed'), 'false');
    await step(0);
    await wireCount(0);

    await connect('power:p', 'power:n');
    await activate(check);
    await wrong(/短接|短路/);
    await step(0);
    await shot(page, `${size}-incorrect-wiring`);
    await activate(undo);
    await wireCount(0);

    const resistanceEnd = phone ? 'rheostat:b' : 'rheostat:p';
    for (const [index, [a, b]] of [
      ['power:p', 'switch:p'], ['switch:n', 'ammeter:p'], ['ammeter:n', 'resistor:p'],
      ['resistor:n', resistanceEnd], ['rheostat:n', 'power:n'],
      ['voltmeter:p', 'resistor:p'], ['voltmeter:n', 'resistor:n']
    ].entries()) {
      await connect(a, b);
      await wireCount(index + 1);
    }
    const wired = await canvasShot(page, scene, `${size}-wired-scene`, assembled);
    await shot(page, `${size}-wired`);
    await activate(check);
    await step(1);
    assert(await replay.isHidden());
    assert.equal(await slider.inputValue(), '50');
    assert(await lever.isHidden());
    await slide(phone ? 100 : 0);
    await step(1);
    assert(await lever.isHidden());

    const setpoints = phone ? [0, 60, 80] : [100, 40, 20];
    if (phone) await slide(setpoints[0]);
    else {
      const point = await center(stageSlider);
      await drag(page, point, { x: point.x + 220, y: point.y });
      assert.equal(await slider.inputValue(), '100');
    }
    await step(2);
    await activate(stageLever);
    await step(3);
    await record.waitFor();
    assert(await record.isEnabled());
    const powered = await canvasShot(page, scene, `${size}-powered-scene`, wired, { minDelta: 25, threshold: 18 });
    await slide(setpoints.at(-1));
    await canvasShot(page, scene, `${size}-adjusted-scene`, powered, { minDelta: 35, threshold: 18 });
    await slide(setpoints[0]);
    for (const [index, value] of setpoints.entries()) {
      const actual = index ? await slide(value) : value;
      const resistance = 50 * (phone ? (1 - actual / 100) : actual / 100);
      const current = 6 / (10 + resistance);
      await activate(record);
      assert.equal(await table.count(), index + 1);
      const cells = await table.nth(index).locator('td').allTextContents();
      assert.deepEqual(cells, [String(index + 1), (current * 10).toFixed(2), current.toFixed(2), '10.0']);
      if (index === 0 && await record.isEnabled()) {
        await activate(record);
        await wrong(/太接近/);
        assert.equal(await table.count(), 1, 'repeated readings must not increase the sample count');
      }
    }
    await chart.waitFor();
    assert.equal(await chart.locator('circle').count(), 3);
    await step(4);
    await shot(page, `${size}-measurements`);
    assert(await open.isVisible());
    await activate(stageLever);
    await page.locator('#player[data-complete="true"]').waitFor();
    assert.match(await page.locator('#hint-text').textContent(), /成正比/);
    assert.equal(await table.count(), 3);
    assert(await replay.isVisible());
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await shot(page, `${size}-complete`);

    await activate(replay);
    await phase('operation');
    await step(0);
    assert.equal(await count.textContent(), '6 / 6');
    assert.equal(await table.count(), 0);
    assert(await replay.isHidden());
    await terminal('power:p').waitFor();
    await wireCount(0);
    await shot(page, `${size}-replay`);
    await activate(rebuild);
    await phase('assembly');
    assert.equal(await count.textContent(), '0 / 6');
    assert(await item('switch').isDisabled());
    assert(await terminal('power:p').isHidden());
    assert(await table.count() === 0);
    assert.deepEqual(errors, []);
    console.log(`Current/voltage ${size}: six assets, protective setup, error recovery, seven wires, three readings, chart and both resets passed.`);
  } finally {
    await page.close();
  }
}

try {
  if (!process.argv.includes('--experiment-only')) {
    await baseline(false);
    await baseline(true);
  }
  if (!process.argv.includes('--baseline-only')) {
    await experiment(false);
    await experiment(true);
  }
} finally {
  await browser.close();
  server?.close();
}
