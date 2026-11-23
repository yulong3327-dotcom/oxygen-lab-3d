import * as T from 'three';
import { checkWiring, measureCircuit, CIRCUIT_SPEC, CIRCUIT_PHASES } from './circuit-model.js';
import { createCableRouter } from './cable-path.js';
import { buildCableStack } from './cable-crossings.js';
import { sizeTerminalTargets } from './circuit-targets.js';

const ns = 'http://www.w3.org/2000/svg';
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const show = (element, value) => { element.hidden = !value; };
const format = (value, decimals = 2) => value.toFixed(decimals);

function button(label, id, icon, primary = false) {
  const control = document.createElement('button');
  control.type = 'button';
  control.id = id;
  control.className = 'btn ' + (primary ? 'btn-primary' : 'btn-ghost');
  if (icon) {
    const glyph = document.createElement('i');
    glyph.dataset.lucide = icon;
    glyph.setAttribute('aria-hidden', 'true');
    control.append(glyph);
  }
  control.append(document.createTextNode(label));
  return control;
}

function svg(tag, attrs) {
  const el = document.createElementNS(ns, tag);
  for (const [key, val] of Object.entries(attrs)) el.setAttribute(key, val);
  return el;
}

function graph(voltageRange, currentRange) {
  const root = svg('svg', { viewBox: '0 0 268 161', class: 'circuit-graph', role: 'img', 'aria-label': 'I–U 图，横轴电压，纵轴电流' });
  const label = (x, y, value, anchor = 'start') => {
    const text = svg('text', { x, y, 'text-anchor': anchor });
    text.textContent = value;
    root.append(text);
  };
  const x = value => 37 + 200 * value / voltageRange;
  const y = value => 130 - 101 * value / currentRange;
  for (let index = 1; index <= 3; index++) {
    const gx = x(voltageRange * index / 3);
    const gy = y(currentRange * index / 3);
    root.append(svg('path', { d: 'M' + gx + ' 29V130 M37 ' + gy + 'H237', class: 'chart-grid' }));
    label(gx, 148, format(voltageRange * index / 3, 0), 'middle');
    label(31, gy + 4, format(currentRange * index / 3, 1), 'end');
  }
  root.append(svg('path', { d: 'M37 23V130H242', class: 'chart-axis' }));
  label(37, 17, 'I / A');
  label(265, 126, 'U / V', 'end');
  label(31, 148, '0', 'end');
  const marks = svg('g', {});
  root.append(marks);
  return {
    root,
    plot(rows) {
      const points = [...rows].sort((a, b) => a.voltage - b.voltage);
      marks.replaceChildren();
      if (points.length > 1) {
        marks.append(svg('polyline', { points: points.map(row => x(row.voltage) + ',' + y(row.current)).join(' ') }));
      }
      for (const row of points) marks.append(svg('circle', { cx: x(row.voltage), cy: y(row.current), r: 3.6 }));
      root.setAttribute('aria-label', 'I–U 图，' + rows.length + ' 个测量点，横轴电压，纵轴电流');
    }
  };
}

export function createCircuitProcedure({ canvas, scene, models, config, active, project, point, complete,
  feedback, update, overlay, controls, data }) {
  const bench = new T.Group();
  scene.add(bench);
  const circuitTab = document.createElement('div');
  circuitTab.className = 'circuit-toolbar';
  controls.append(circuitTab);
  const wireStatus = document.createElement('output');
  wireStatus.id = 'circuit-wire-count';
  wireStatus.className = 'circuit-count';
  const undo = button('撤销接线', 'circuit-undo', 'undo-2');
  const check = button('检查接线', 'circuit-check', 'check', true);
  const lever = button('闭合开关', 'circuit-switch', 'power', true);
  const open = button('断开开关', 'circuit-open', 'power');
  const record = button('记录一组', 'circuit-record', 'plus', true);
  const stageLever = button('闭合开关', 'circuit-switch-marker', 'power');
  stageLever.className = 'btn circuit-lever-marker';
  const stageSlider = button('', 'circuit-slider-marker');
  stageSlider.className = 'sandbox-handle';
  stageSlider.setAttribute('aria-label', '拖动滑片');
  stageSlider.title = '沿滑杆拖动，或使用下方的滑片控制';
  overlay.append(stageLever, stageSlider);
  const sliderLabel = document.createElement('label');
  sliderLabel.className = 'circuit-slider';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.id = 'circuit-slider';
  slider.min = '0'; slider.max = '100'; slider.step = '1';
  const resistanceLabel = document.createElement('output');
  resistanceLabel.htmlFor = slider.id;
  const sliderCaption = document.createElement('span');
  sliderCaption.textContent = '滑片 P';
  sliderLabel.append(sliderCaption, slider, resistanceLabel);
  const readouts = document.createElement('div');
  readouts.className = 'circuit-readouts';
  const readings = ['电压表', '电流表'].map((name, index) => {
    const wrap = document.createElement('span');
    const label = document.createElement('span');
    const value = document.createElement('output');
    label.textContent = name;
    value.id = index ? 'circuit-current' : 'circuit-voltage';
    value.setAttribute('aria-label', name + '读数');
    wrap.append(label, value);
    readouts.append(wrap);
    return value;
  });
  circuitTab.append(wireStatus, undo, check, sliderLabel, lever, readouts, record, open);

  const measureTitle = document.createElement('h3');
  measureTitle.textContent = '测量记录';
  const table = document.createElement('table');
  table.className = 'circuit-table';
  table.setAttribute('aria-label', '电流与电压实验数据');
  const head = table.createTHead().insertRow();
  for (const text of ['序号', 'U / V', 'I / A', 'U/I / Ω']) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = text;
    head.append(cell);
  }
  const body = table.createTBody();
  const { voltmeterRange: voltageRange, ammeterRange: currentRange } = CIRCUIT_SPEC;
  const chart = graph(voltageRange, currentRange);
  const dataNote = document.createElement('p');
  dataNote.className = 'step-detail circuit-data-note';
  data.append(measureTitle, table, chart.root, dataNote);

  const line = document.createElement('div');
  line.className = 'circuit-drag-line';
  line.hidden = true;
  line.setAttribute('aria-hidden', 'true');
  overlay.append(line);
  const terminals = Object.entries(config.terminals).map(([id, info]) => {
    const [instrumentId, anchor] = id.split(':');
    const control = button('', 'terminal-' + instrumentId + '-' + anchor);
    control.className = 'circuit-terminal';
    control.dataset.terminal = id;
    control.dataset.mark = info.mark;
    control.setAttribute('aria-label', info.label);
    control.title = info.label;
    overlay.append(control);
    return { id, info, ref: { instrumentId, anchor: info.anchor ?? anchor }, control, button: control };
  });
  const byTerminal = new Map(terminals.map(item => [item.id, item]));
  const wires = [];
  const paths = [];
  const meshes = [];
  const rows = [];
  let selected, gesture, lastStep, wiring, slideGesture, slideRail;
  let closed = false;
  let position = config.sliderInitial ?? 1;
  let suppressClickUntil = 0;
  let lastReading;
  let needsView = false;
  const phase = () => active()?.action.type;

  function motion(part) {
    const object = models.get(part.instrumentId).group.getObjectByName(part.node);
    if (!object) throw new Error('电学模型缺少活动部件：' + part.node);
    const startRotation = object.rotation.clone();
    const startPosition = object.position.clone();
    return fraction => {
      object.rotation.copy(startRotation);
      object.position.copy(startPosition);
      if (part.rotate) object.rotateOnAxis(new T.Vector3().fromArray(part.rotate.axis), part.rotate.arc * fraction);
      if (part.position) object.position[part.position.axis] = T.MathUtils.lerp(part.position.min, part.position.max, fraction);
    };
  }
  const animateSwitch = motion(config.parts.switch);
  const animateSlider = motion(config.parts.slider);
  const animateAmmeter = motion(config.parts.ammeter);
  const animateVoltmeter = motion(config.parts.voltmeter);

  function reading() {
    lastReading = measureCircuit(wiring, position, closed);
    slider.value = String(Math.round(position * 100));
    resistanceLabel.textContent = wiring?.ok ? format(lastReading.rheostatOhms, 1) + ' Ω' : '';
    readings[0].textContent = format(lastReading.voltage) + ' V';
    readings[1].textContent = format(lastReading.current) + ' A';
    animateSwitch(closed ? 1 : 0);
    animateSlider(position);
    animateAmmeter(clamp(lastReading.current / currentRange, 0, 1));
    animateVoltmeter(clamp(lastReading.voltage / voltageRange, 0, 1));
  }

  function timeline() {
    body.replaceChildren();
    rows.forEach((row, index) => {
      const tr = body.insertRow();
      for (const value of [index + 1, format(row.voltage), format(row.current), format(row.voltage / row.current, 1)]) {
        tr.insertCell().textContent = value;
      }
    });
    chart.plot(rows);
    dataNote.textContent = rows.length
      ? '已记录 ' + rows.length + ' / ' + config.samples + ' 组'
      : '尚无测量记录';
  }

  function clearDrag() {
    const previous = gesture;
    gesture = undefined;
    if (previous?.item.control.hasPointerCapture(previous.pointer)) previous.item.control.releasePointerCapture(previous.pointer);
    line.hidden = true;
    for (const item of terminals) item.control.removeAttribute('data-target');
  }

  function redrawSelection() {
    for (const item of terminals) item.control.setAttribute('aria-pressed', String(selected === item.id));
  }

  function wireColor(a, b) {
    if ([a, b].includes('power:n')) return 0x263647;
    return [a, b].some(id => id.startsWith('voltmeter:')) ? 0x186d98 : 0xae3934;
  }

  function makeWire(aId, bId) {
    const route = createCableRouter([...models].filter(([, model]) => model.group.visible).map(([id, { group }]) => ({
      group, faceFront: id === config.parts.ammeter.instrumentId || id === config.parts.voltmeter.instrumentId
    })));
    const endpoint = id => {
      const { ref } = byTerminal.get(id);
      return { group: models.get(ref.instrumentId).group, position: point(ref) };
    };
    const base = route(...[aId, bId].sort().map(endpoint));
    paths.push(base);
    const curve = buildCableStack(paths).at(-1);
    const color = wireColor(aId, bId);
    const material = new T.MeshStandardMaterial({ color, roughness: .56 });
    const segments = clamp(Math.ceil(base.getLength() / .005), 50, 420);
    const mesh = new T.Mesh(new T.TubeGeometry(curve, segments, .0028, 8, false), material);
    bench.add(mesh);
    meshes.push(mesh);
  }

  function removeWire() {
    wires.pop();
    paths.pop();
    const mesh = meshes.pop();
    if (mesh) {
      bench.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }

  function connect(first, second) {
    if (first === second) return;
    if (wires.some(([a, b]) => (a === first && b === second) || (b === first && a === second))) {
      feedback('这两个接线柱已相连。', 'wrong');
      return;
    }
    if (wires.length >= config.wireCount) {
      feedback('先检查现有接线，或撤销一根导线。', 'wrong');
      return;
    }
    wires.push([first, second]);
    makeWire(first, second);
    selected = undefined;
    redrawSelection();
    feedback('已接 ' + wires.length + ' 根导线。');
    update();
  }

  function choose(item) {
    if (phase() !== 'circuit-wire') return;
    if (!selected || selected === item.id) {
      selected = selected ? undefined : item.id;
      feedback(selected ? '已选中' + item.info.label + '。' : '已取消选择。');
      redrawSelection();
    } else connect(selected, item.id);
  }

  function dragTarget(clientX, clientY, first) {
    const direct = document.elementFromPoint(clientX, clientY)?.closest('.circuit-terminal')?.dataset.terminal;
    if (direct && direct !== first) return byTerminal.get(direct);
    let best, near = 19;
    for (const item of terminals) {
      if (item.id === first || item.control.hidden) continue;
      const r = item.control.getBoundingClientRect();
      const distance = Math.hypot(r.x + r.width / 2 - clientX, r.y + r.height / 2 - clientY);
      if (distance < near) { best = item; near = distance; }
    }
    return best;
  }

  for (const item of terminals) {
    const { control } = item;
    control.addEventListener('click', event => {
      if (event.detail === 0 || performance.now() >= suppressClickUntil) choose(item);
    });
    control.addEventListener('pointerdown', event => {
      if (event.button !== 0 || gesture || phase() !== 'circuit-wire') return;
      gesture = { item, pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
      control.setPointerCapture(event.pointerId);
    });
    control.addEventListener('pointermove', event => {
      if (gesture?.pointer !== event.pointerId || (!gesture.moved && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 6)) return;
      gesture.moved = true;
      const hit = dragTarget(event.clientX, event.clientY, item.id);
      for (const target of terminals) target.control.toggleAttribute('data-target', target === hit);
      const bounds = overlay.getBoundingClientRect();
      const dx = event.clientX - bounds.left - item.x, dy = event.clientY - bounds.top - item.y;
      line.style.left = item.x + 'px';
      line.style.top = item.y + 'px';
      line.style.width = Math.hypot(dx, dy) + 'px';
      line.style.transform = 'rotate(' + Math.atan2(dy, dx) + 'rad)';
      line.hidden = false;
    });
    control.addEventListener('pointerup', event => {
      if (gesture?.pointer !== event.pointerId) return;
      const moved = gesture.moved;
      clearDrag();
      if (moved) {
        suppressClickUntil = performance.now() + 350;
        const target = dragTarget(event.clientX, event.clientY, item.id);
        if (target) connect(item.id, target.id);
        else {
          selected = undefined;
          redrawSelection();
          feedback('导线未接入。', 'wrong');
        }
      } else {
        // Captured touch events can suppress the compatibility click on some browsers.
        suppressClickUntil = performance.now() + 350;
        choose(item);
      }
    });
    for (const event of ['pointercancel', 'lostpointercapture']) control.addEventListener(event, e => {
      if (gesture?.pointer !== e.pointerId) return;
      clearDrag();
      selected = undefined;
      redrawSelection();
      feedback('已取消接线。', 'wrong');
    });
  }
  overlay.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || phase() !== 'circuit-wire' || !(selected || gesture)) return;
    event.preventDefault();
    clearDrag();
    selected = undefined;
    redrawSelection();
    feedback('已取消接线。');
  });
  undo.addEventListener('click', () => {
    if (phase() !== 'circuit-wire' || !wires.length) return;
    removeWire();
    selected = undefined;
    redrawSelection();
    feedback('已撤销最后一根导线。');
    update();
  });
  check.addEventListener('click', () => {
    if (phase() !== 'circuit-wire') return;
    const result = checkWiring(wires);
    if (!result.ok) return feedback(result.message, 'wrong');
    wiring = result;
    selected = undefined;
    clearDrag();
    reading();
    complete();
    slider.focus({ preventScroll: true });
  });
  function setSlider(fraction) {
    if (!['circuit-prepare', 'circuit-measure'].includes(phase())) return;
    position = Math.round(clamp(fraction, 0, 1) * 100) / 100;
    reading();
    if (phase() === 'circuit-prepare' && Math.abs(position - wiring.maxPosition) < .005) {
      stopSlide();
      complete();
      if ([slider, stageSlider].includes(document.activeElement)) lever.focus({ preventScroll: true });
    } else update();
  }
  slider.addEventListener('input', () => setSlider(Number(slider.value) / 100));
  function stopSlide() {
    const previous = slideGesture;
    slideGesture = undefined;
    if (previous && stageSlider.hasPointerCapture(previous.id)) stageSlider.releasePointerCapture(previous.id);
  }
  stageSlider.addEventListener('click', () => slider.focus({ preventScroll: true }));
  stageSlider.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !slideRail || slideGesture) return;
    const [left, right] = slideRail;
    const dx = right.x - left.x, dy = right.y - left.y;
    if (Math.hypot(dx, dy) < 10) return;
    slideGesture = { id: event.pointerId, x: event.clientX, y: event.clientY, position, dx, dy };
    stageSlider.setPointerCapture(event.pointerId);
  });
  stageSlider.addEventListener('pointermove', event => {
    if (slideGesture?.id !== event.pointerId) return;
    const { position: start, x, y, dx, dy } = slideGesture;
    setSlider(start + ((event.clientX - x) * dx + (event.clientY - y) * dy) / (dx * dx + dy * dy));
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) stageSlider.addEventListener(event, e => {
    if (slideGesture?.id === e.pointerId) stopSlide();
  });
  function flip() {
    if (phase() === 'circuit-close') closed = true;
    else if (phase() === 'circuit-open') closed = false;
    else return;
    reading();
    complete();
  }
  for (const control of [lever, open, stageLever]) control.addEventListener('click', flip);
  record.addEventListener('click', () => {
    if (phase() !== 'circuit-measure' || !closed) return;
    const { voltage, current } = lastReading;
    if (rows.some(row => Math.abs(row.voltage - voltage) < config.minVoltageGap - 1e-8)) {
      return feedback('这次电压与已有记录太接近。请再移动滑片。', 'wrong');
    }
    rows.push({ voltage, current });
    timeline();
    if (rows.length >= config.samples) {
      complete();
      if (document.activeElement === document.body) open.focus({ preventScroll: true });
    } else {
      feedback('已记录第 ' + rows.length + ' 组：' + format(voltage) + ' V，' + format(current) + ' A。');
    }
  });

  function positionTerminals() {
    const visible = [];
    for (const item of terminals) {
      const p = project(point(item.ref));
      show(item.control, p.visible);
      if (!p.visible) { needsView = true; continue; }
      item.x = p.x; item.y = p.y;
      item.control.style.left = p.x + 'px';
      item.control.style.top = p.y + 'px';
      visible.push(item);
    }
    sizeTerminalTargets(visible);
  }

  function render() {
    const current = phase();
    const running = CIRCUIT_PHASES.includes(current);
    const wiringMode = current === 'circuit-wire';
    const switching = current === 'circuit-close' || current === 'circuit-open';
    const sliding = current === 'circuit-prepare' || current === 'circuit-measure';
    needsView = false;
    if (current !== lastStep) {
      lastStep = current;
      controls.dataset.stage = current ?? '';
      show(controls, running);
      show(overlay, wiringMode || switching || sliding);
      show(wireStatus, wiringMode);
      show(undo, wiringMode);
      show(check, wiringMode);
      show(sliderLabel, sliding);
      show(lever, current === 'circuit-close');
      show(open, current === 'circuit-open');
      show(record, current === 'circuit-measure');
      show(readouts, current === 'circuit-measure' || current === 'circuit-open');
      stageLever.lastChild.textContent = current === 'circuit-open' ? '断开开关' : '闭合开关';
      for (const item of terminals) show(item.control, wiringMode);
    }
    show(data, Boolean(wiring?.ok));
    if (wiringMode) {
      wireStatus.textContent = '导线 ' + wires.length + ' / ' + config.wireCount;
      overlay.dataset.wireCount = String(wires.length);
      undo.disabled = !wires.length;
      positionTerminals();
    }
    if (switching) {
      const p = project(point(config.parts.switch.marker));
      show(stageLever, p.visible);
      needsView ||= !p.visible;
      if (p.visible) {
        stageLever.style.left = clamp(p.x, 55, canvas.clientWidth - 55) + 'px';
        stageLever.style.top = clamp(p.y - 22, 19, canvas.clientHeight - 19) + 'px';
      }
    } else stageLever.hidden = true;
    if (sliding) {
      const { rail, instrumentId } = config.parts.slider;
      const ends = rail.map(at => point({ instrumentId, at }));
      slideRail = ends.map(project);
      const p = project(ends[0].lerp(ends[1], position));
      show(stageSlider, p.visible && slideRail.every(end => end.visible));
      if (p.visible) {
        stageSlider.style.left = p.x + 'px';
        stageSlider.style.top = p.y + 'px';
      }
    } else stageSlider.hidden = true;
  }

  function reset() {
    clearDrag();
    stopSlide();
    selected = undefined;
    wiring = undefined;
    closed = false;
    position = config.sliderInitial ?? 1;
    while (wires.length) removeWire();
    overlay.dataset.wireCount = '0';
    rows.length = 0;
    redrawSelection();
    reading();
    timeline();
    lastStep = null;
  }
  return { render, reset, needsView: () => needsView,
    focusCurrent() {
      const target = phase() === 'circuit-wire' ? terminals.find(x => !x.control.hidden)?.control
        : phase() === 'circuit-close' ? lever : phase() === 'circuit-open' ? open : slider;
      target?.focus({ preventScroll: true });
    } };
}
