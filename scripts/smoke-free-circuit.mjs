import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, devices } from 'playwright';
import { serve } from './lab.mjs';
import { root } from './lab-core.mjs';

const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const server = process.env.LAB_PREVIEW_ORIGIN ? null : await serve({ port: 0 });
const origin = process.env.LAB_PREVIEW_ORIGIN ?? `http://127.0.0.1:${server.address().port}`;
const output = resolve(root, '.lab-output/free-circuit');
mkdirSync(output, { recursive: true });
const mobile = { ...devices['iPhone 13'], browserName: undefined };
const desktop = { viewport: { width: 1440, height: 900 } };
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

async function point(locator, x = .5, y = .5) {
  const box = await locator.boundingBox();
  assert(box, `${locator} must have a visible bounding box`);
  return { x: box.x + box.width * x, y: box.y + box.height * y };
}

async function drag(page, from, to, touch) {
  if (!touch) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
    return;
  }
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  for (let i = 1; i <= 10; i++) {
    const x = from.x + (to.x - from.x) * i / 10;
    const y = from.y + (to.y - from.y) * i / 10;
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  }
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

const photo = (page, name) => page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true, scale: 'css' });

async function canvasPicture(canvas, name) {
  return canvas.screenshot({
    path: resolve(output, `${name}.png`), scale: 'css', style: '.lab-overlay { visibility: hidden !important; }'
  });
}

async function changedPixels(page, before, after, name, minimum) {
  const change = await page.evaluate(async images => {
    async function unpack(encoded) {
      const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${encoded}`)).blob());
      const ctx = new OffscreenCanvas(image.width, image.height).getContext('2d');
      ctx.drawImage(image, 0, 0);
      return ctx.getImageData(0, 0, image.width, image.height).data;
    }
    const [old, current] = await Promise.all(images.map(unpack));
    if (old.length !== current.length) return -1;
    let delta = 0;
    for (let p = 0; p < current.length; p += 4) {
      if (Math.abs(current[p] - old[p]) + Math.abs(current[p + 1] - old[p + 1]) + Math.abs(current[p + 2] - old[p + 2]) > 35) delta++;
    }
    return delta;
  }, [before.toString('base64'), after.toString('base64')]);
  assert(change >= minimum, `${name}: expected ${minimum} changed pixels, got ${change}`);
  return change;
}

async function blueCablePoints(page, image, a, b) {
  return page.evaluate(async ({ encoded, a, b }) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${encoded}`)).blob());
    const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const candidates = [];
    for (let y = Math.max(0, Math.floor(center.y - 15)); y < Math.min(bitmap.height, center.y + 15); y++) {
      for (let x = Math.max(0, Math.floor(center.x - 45)); x < Math.min(bitmap.width, center.x + 45); x++) {
        const p = (x + y * bitmap.width) * 4;
        const [r, g, b] = pixels.subarray(p, p + 3);
        if (r < 100 && b > r + 25 && g > r + 16) candidates.push({ x, y });
      }
    }
    return candidates.sort((a, b) => Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(b.x - center.x, b.y - center.y)).slice(0, 18);
  }, { encoded: image.toString('base64'), a, b });
}

const deviceLocations = {
  resistor: [.48, .68], voltmeter: [.49, .34], ammeter: [.76, .67], power: [.23, .31], switch: [.77, .34]
};
const circuit = [
  ['power:p', 'switch:p'], ['switch:n', 'ammeter:p'], ['ammeter:n', 'resistor:p'],
  ['resistor:n', 'power:n'], ['voltmeter:p', 'resistor:p'], ['voltmeter:n', 'resistor:n']
];

async function freeBench(phone) {
  const size = phone ? 'mobile' : 'desktop';
  const page = await browser.newPage({ ...(phone ? mobile : desktop), reducedMotion: 'reduce' });
  page.setDefaultTimeout(8000);
  const touch = phone ? await page.context().newCDPSession(page) : undefined;
  const errors = watch(page);
  const activate = el => phone ? el.tap() : el.click();
  const bench = page.locator('#scene');
  const tool = id => page.locator(`#instruments [data-add-device="${id}"]`);
  const terminal = ref => {
    const [id, port] = ref.split(':');
    return page.locator(`button[data-terminal="${id}-1:${port}"]`);
  };
  const terminals = page.locator('button[data-terminal]:visible');
  const wireMode = page.locator('#free-wire-mode');
  const panMode = page.locator('#free-pan-mode');
  const actuator = id => page.locator(`[data-actuator="${id}-1"]`);
  const device = (id, ordinal = 1) => page.locator(`[data-select-device="${id}-${ordinal}"]`);
  const pins = id => Promise.all(['p', 'n'].map(port => terminal(`${id}:${port}`).evaluate(button => ({
    x: parseFloat(button.style.left), y: parseFloat(button.style.top)
  }))));
  const readouts = ['[data-meter="voltmeter-1"]', '[data-meter="ammeter-1"]'];
  const undo = page.locator('#free-undo');
  const deleteDevice = page.locator('#free-remove');
  const deleteWire = page.locator('#free-remove-wire');
  const wireCount = count => page.waitForFunction(count => {
    const output = document.querySelector('#free-wire-count');
    return output && Number(output.dataset.count ?? output.textContent.match(/\d+/)?.[0]) === count;
  }, count);

  async function setWireMode(enabled) {
    const button = enabled ? wireMode : page.locator('#free-move-mode');
    if (await button.getAttribute('aria-pressed') !== 'true') await activate(button);
    await page.locator(`#free-wire-mode[aria-pressed="${enabled}"]`).waitFor();
  }

  async function readings(voltage, current) {
    await page.waitForFunction(([selectors, values]) => selectors.every((selector, index) => {
      const raw = document.querySelector(selector)?.dataset.reading;
      return raw && Math.abs(Number(raw) - values[index]) < (index ? .008 : .08);
    }), [readouts, [voltage, current]]);
  }

  async function connect(a, b) {
    const start = terminal(a), end = terminal(b);
    await bench.scrollIntoViewIfNeeded();
    if (phone) {
      await activate(start);
      await activate(end);
    } else {
      await drag(page, await point(start), await point(end));
    }
  }

  async function place(id, fractions, ordinal = 1) {
    const pick = tool(id);
    if (phone) {
      await activate(pick);
      assert.equal(await pick.getAttribute('aria-pressed'), 'true');
      assert.equal(await device(id, ordinal).count(), 0, `${id} should wait for the bench tap`);
      await bench.scrollIntoViewIfNeeded();
      const { x, y } = await point(bench, ...fractions);
      await page.touchscreen.tap(x, y);
    } else {
      await bench.scrollIntoViewIfNeeded();
      await pick.scrollIntoViewIfNeeded();
      await drag(page, await point(pick.locator('img')), await point(bench, ...fractions));
    }
    await device(id, ordinal).waitFor({ state: 'attached' });
  }

  async function tapAt(x, y) {
    if (phone) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
  }

  async function selectResistor() {
    await bench.scrollIntoViewIfNeeded();
    const [p, n] = await pins('resistor');
    const bounds = await bench.boundingBox();
    const center = { x: bounds.x + (p.x + n.x) / 2, y: bounds.y + (p.y + n.y) / 2 };
    const candidates = [];
    for (const dy of [6, 3, 0, 8, 10, 12, 15, 18, -3]) {
      const from = { x: Math.round(center.x), y: Math.round(center.y + dy) };
      const hit = await page.evaluate(({ x, y }) => {
        const element = document.elementFromPoint(x, y);
        return element && (element.dataset.terminal || element.dataset.actuator || element.id || element.tagName);
      }, from);
      candidates.push({ ...from, hit });
      const onCanvas = hit === 'scene';
      if (!onCanvas) continue;
      await tapAt(from.x, from.y);
      if (await device('resistor').isVisible()) return from;
    }
    const targets = await page.locator('[data-terminal^="resistor-1:"]').evaluateAll(buttons => buttons.map(button => ({
      id: button.dataset.terminal,
      hitBox: button.getBoundingClientRect().toJSON(),
      requestedSize: button.style.getPropertyValue('--terminal-size')
    })));
    throw new Error(`${size}: the resistor body should be selectable between its terminals: ${JSON.stringify({ center, candidates, targets })}`);
  }

  async function verifyLibrary() {
    await page.waitForFunction(() => [...document.querySelectorAll('[data-add-device] img')]
      .every(image => image.complete && image.naturalWidth > 0));
    const layout = await page.evaluate(() => {
      const grid = document.querySelector('#instruments');
      const { left, right } = grid.getBoundingClientRect();
      const cards = [...grid.querySelectorAll('[data-add-device]')].map(node => {
        const bounds = node.getBoundingClientRect();
        const image = node.querySelector('img').getBoundingClientRect();
        const label = document.createRange();
        label.selectNodeContents(node.querySelector('span'));
        return { id: node.dataset.addDevice, bounds, image, lines: [...label.getClientRects()] };
      });
      const epsilon = .75;
      const outside = (box, parent) => box.left < parent.left - epsilon || box.right > parent.right + epsilon
        || box.top < parent.top - epsilon || box.bottom > parent.bottom + epsilon;
      const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > epsilon
        && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > epsilon;
      const issues = [];
      for (let i = 0; i < cards.length; i++) {
        const { id, bounds, image, lines } = cards[i];
        if (bounds.left < left - epsilon || bounds.right > right + epsilon) issues.push(`${id} overflows library`);
        if (outside(image, bounds) || lines.some(line => outside(line, bounds))) issues.push(`${id} clips content`);
        if (lines.some(line => overlaps(line, image))) issues.push(`${id} has an image and label overlap`);
        for (const other of cards.slice(i + 1)) if (overlaps(bounds, other.bounds)) issues.push(`${id} overlaps ${other.id}`);
      }
      return { count: cards.length, issues };
    });
    assert.equal(layout.count, 24, `${size}: the full apparatus library should be available`);
    assert.deepEqual(layout.issues, []);
    console.log(`Free circuit ${size}: ${layout.count} apparatus cards fit without overlap.`);
    await page.screenshot({
      path: resolve(output, `${size}-all-library.png`), fullPage: true, scale: 'css',
      style: '#instruments { max-height: none !important; overflow: visible !important; }'
    });
  }

  try {
    await page.goto(`${origin}/platform/player.html?id=current-voltage`);
    await page.locator('#player[data-ready="true"]').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('#assembly-overlay [data-slot]').count(), 0);
    assert(await page.locator('#phase-list').isHidden());
    assert.equal(await terminals.count(), 0);
    assert.equal(await page.locator('[data-select-device]').count(), 0);
    await wireCount(0);
    const inputs = page.locator('#instruments [data-add-device]');
    for (const id of [...Object.keys(deviceLocations), 'rheostat']) await tool(id).waitFor();
    for (const button of await inputs.all()) assert(await button.isEnabled());
    await verifyLibrary();
    await photo(page, `${size}-empty`);
    const empty = await canvasPicture(bench, `${size}-empty-scene`);

    for (const [id, fractions] of Object.entries(deviceLocations)) await place(id, fractions);
    const placed = await canvasPicture(bench, `${size}-placed-scene`);
    await changedPixels(page, empty, placed, `${size} placed equipment`, 250);

    await setWireMode(true);
    assert.equal(await terminals.count(), 10);
    for (const [index, [from, to]] of circuit.entries()) {
      await connect(from, to);
      await wireCount(index + 1);
    }
    const wired = await canvasPicture(bench, `${size}-wired-scene`);
    await changedPixels(page, placed, wired, `${size} drawn wires`, 150);
    await photo(page, `${size}-wired`);

    await activate(undo);
    await wireCount(5);
    await connect(...circuit.at(-1));
    await wireCount(6);
    const diagram = page.locator('#free-diagram-panel');
    await activate(page.locator('#free-diagram'));
    await diagram.waitFor();
    assert.equal(await diagram.locator('[data-circuit-device]').count(), 5);
    await activate(page.locator('#free-diagram'));
    await diagram.waitFor({ state: 'hidden' });

    await setWireMode(false);
    await readings(0, 0);
    await activate(actuator('switch'));
    await readings(6, .6);
    const powered = await canvasPicture(bench, `${size}-powered-scene`);
    await changedPixels(page, wired, powered, `${size} switch and meters moved`, 30);
    await photo(page, `${size}-reading`);
    await activate(actuator('switch'));
    await readings(0, 0);

    await setWireMode(true);
    await bench.scrollIntoViewIfNeeded();
    const [beforeP] = await pins('resistor');
    await setWireMode(false);
    const from = await selectResistor();
    const benchBox = await bench.boundingBox();
    await drag(page, from, { x: from.x - benchBox.width * .10, y: from.y + benchBox.height * .09 }, touch);
    await wireCount(6);
    const moved = await canvasPicture(bench, `${size}-moved-scene`);
    await changedPixels(page, wired, moved, `${size} connected resistor moved`, 190);
    await setWireMode(true);
    await bench.scrollIntoViewIfNeeded();
    const [afterP] = await pins('resistor');
    assert(Math.hypot(afterP.x - beforeP.x, afterP.y - beforeP.y) > 24, `${size}: resistor terminals should move with it`);
    await photo(page, `${size}-moved`);

    assert.equal(await page.locator('[data-select-device]:visible').count(), 1);
    assert(await device('resistor').isVisible());
    await bench.scrollIntoViewIfNeeded();
    const position = await bench.boundingBox();
    const [meterP] = await pins('voltmeter');
    const candidates = await blueCablePoints(page, moved, meterP, afterP);
    for (const candidate of candidates) {
      await tapAt(position.x + candidate.x, position.y + candidate.y);
      if (await deleteWire.isVisible()) break;
    }
    assert(await deleteWire.isVisible(), `${size}: a drawn blue lead must be selectable on the canvas`);
    await activate(deleteWire);
    await wireCount(5);
    const withRemovedWire = await canvasPicture(bench, `${size}-wire-removed-scene`);
    await changedPixels(page, moved, withRemovedWire, `${size} connected wire mesh removed`, 35);

    await setWireMode(false);
    await selectResistor();
    assert(await device('resistor').isVisible());
    await activate(deleteDevice);
    await device('resistor').waitFor({ state: 'detached' });
    await wireCount(2);
    assert(await terminal('resistor:p').isHidden());
    await photo(page, `${size}-device-removed`);

    await activate(panMode);
    assert.equal(await panMode.getAttribute('aria-pressed'), 'true');
    await bench.scrollIntoViewIfNeeded();
    const near = await canvasPicture(bench, `${size}-near-view-scene`);
    for (let i = 0; i < 3; i++) await drag(page, await point(bench, .78, .5), await point(bench, .22, .5), touch);
    const far = await canvasPicture(bench, `${size}-far-empty-scene`);
    await changedPixels(page, near, far, `${size} panned beyond original bench`, 300);
    assert.equal(await page.locator('[data-select-device]').count(), 4);
    await wireCount(2);
    await setWireMode(true);
    await terminal('power:p').waitFor({ state: 'hidden' });
    await place('power', [.5, .52], 2);
    await setWireMode(true);
    await page.locator('[data-terminal="power-2:p"]').waitFor();
    await terminal('power:p').waitFor({ state: 'hidden' });
    const farPlaced = await canvasPicture(bench, `${size}-far-placed-scene`);
    await changedPixels(page, far, farPlaced, `${size} equipment placed far from origin`, 100);
    await photo(page, `${size}-far-placed`);
    if (!phone) {
      const { x, y } = await point(bench);
      await page.mouse.move(x, y);
      await page.mouse.wheel(0, -270);
      const zoomed = await canvasPicture(bench, `${size}-far-zoomed-scene`);
      await changedPixels(page, farPlaced, zoomed, `${size} wheel zoom after pan`, 200);
    }
    await activate(page.locator('#reset-view'));
    await terminal('power:p').waitFor();
    await page.locator('[data-terminal="power-2:p"]').waitFor();

    await activate(page.locator('#free-clear'));
    await wireCount(0);
    assert.equal(await page.locator('[data-select-device]').count(), 0);
    for (const [id, fractions] of Object.entries({ ...deviceLocations, rheostat: [.24, .65] })) await place(id, fractions);
    await setWireMode(true);
    const withRheostat = [
      ...circuit.slice(0, 3), ['resistor:n', 'rheostat:p'], ['rheostat:n', 'power:n'], ...circuit.slice(4)
    ];
    for (const [index, [start, end]] of withRheostat.entries()) {
      await connect(start, end);
      await wireCount(index + 1);
    }
    await setWireMode(false);
    await activate(actuator('switch'));
    await readings(1.71, .171);
    const normalReadings = await canvasPicture(bench, `${size}-direct-slider-start-scene`);
    const slider = actuator('rheostat');
    await slider.scrollIntoViewIfNeeded();
    const handle = await point(slider), sceneBounds = await bench.boundingBox();
    await drag(page, handle, { x: handle.x + sceneBounds.width * .27, y: handle.y }, touch);
    await readings(1, .1);
    const changedReadings = await canvasPicture(bench, `${size}-direct-slider-adjusted-scene`);
    await changedPixels(page, normalReadings, changedReadings, `${size} direct slide changes the model and readings`, 25);
    await photo(page, `${size}-direct-controls`);
    await activate(actuator('switch'));
    await readings(0, 0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    console.log(`Free circuit ${size}: placement, wiring, movement, deletions, distant pan and direct 3D controls passed.`);
  } catch (error) {
    await photo(page, `${size}-failure`).catch(() => {});
    throw error;
  } finally {
    await page.close();
  }
}

try {
  if (!process.argv.includes('--mobile-only')) await freeBench(false);
  if (!process.argv.includes('--desktop-only')) await freeBench(true);
} finally {
  await browser.close();
  server?.close();
}
