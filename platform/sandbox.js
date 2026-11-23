import * as T from 'three';
import { solveSandbox, SANDBOX_ELECTRICAL } from './sandbox-circuit.js';
import { createLiveDiagram } from './sandbox-diagram.js';
import { createCableRouter } from './cable-path.js';
import { buildCableStack } from './cable-crossings.js';
import { sizeTerminalTargets } from './circuit-targets.js';
import { setupSandboxLighting, addSandboxLighting, updateSandboxLighting, disposeSandboxLighting } from './sandbox-lighting.js';

const el = id => document.getElementById(id);
const clamp = T.MathUtils.clamp;
const minZoom = .22;
const maxZoom = 48;
const range = { ammeter: .6, voltmeter: 6, galvanometer: .003, 'multimeter-current': .6, 'multimeter-voltage': 6 };
const unit = { ammeter: 'A', voltmeter: 'V', galvanometer: 'mA', 'multimeter-current': 'A', 'multimeter-voltage': 'V' };
const variableResistance = { rheostat: SANDBOX_ELECTRICAL.rheostatOhms, 'pencil-rheostat': SANDBOX_ELECTRICAL.pencilRheostatOhms, potentiometer: SANDBOX_ELECTRICAL.potentiometerOhms };
const pair = (a, b) => a < b ? [a, b] : [b, a];
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function control(label, id, icon, extra = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-ghost ' + extra;
  if (id) button.id = id;
  if (icon) {
    const glyph = document.createElement('i');
    glyph.dataset.lucide = icon;
    glyph.setAttribute('aria-hidden', 'true');
    button.append(glyph);
  }
  if (label) button.append(label);
  return button;
}

function label(text, tag = 'span', className = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

export function startSandbox({ experiment, assets, models, localUrl, player, canvas, feedback }) {
  const brand = document.querySelector('.site-brand');
  brand.querySelector('.brand-name').textContent = '物理实验室';
  brand.querySelector('[data-lucide]')?.setAttribute('data-lucide', 'zap');
  brand.querySelector('svg')?.replaceWith(control('', '', 'zap').firstChild);
  brand.setAttribute('aria-label', '返回实验室目录');
  el('experiment-title').textContent = '电学自由画布';
  el('station-title').textContent = '3D 画布';
  document.title = '电学自由画布 · 物理实验室';
  player.dataset.sandbox = '';
  canvas.setAttribute('aria-label', '3D 电学实验台');
  const overlay = el('circuit-overlay');
  overlay.classList.add('sandbox-connection-layer');
  overlay.hidden = false;
  const tools = el('circuit-controls');
  tools.hidden = false;
  tools.className = 'sandbox-toolbar';
  const toolbar = el('practice-label');
  toolbar.replaceChildren();
  toolbar.className = 'sandbox-modes';
  const moveMode = control('摆放', 'free-move-mode', 'move');
  const wireMode = control('接线', 'free-wire-mode', 'cable');
  const panMode = control('平移', 'free-pan-mode', 'hand');
  panMode.title = '拖动空白处平移；其他模式可按 Shift 平移';
  const frontView = control('正视图', 'free-front-view', 'scan');
  frontView.title = '恢复斜向下的视角并显示全图';
  const diagramToggle = control('电路图', 'free-diagram', 'workflow');
  const viewLock = control('锁定视角', 'free-view-lock', 'lock');
  viewLock.setAttribute('aria-pressed', 'false');
  toolbar.setAttribute('role', 'group');
  toolbar.setAttribute('aria-label', '台面工具');
  toolbar.append(moveMode, wireMode, panMode, frontView, viewLock, diagramToggle);
  const clear = control('清空台面', 'free-clear', 'trash-2');
  const undo = control('撤销接线', 'free-undo', 'undo-2');
  const remove = control('移除器材', 'free-remove', 'trash-2');
  const removeCable = control('移除导线', 'free-remove-wire', 'trash-2');
  removeCable.hidden = true;
  const rotate = control('转动器材', 'free-rotate', 'rotate-cw');
  const sideView = control('侧视器材', 'free-side-view', 'view');
  const switchButton = control(null, 'free-switch', 'power');
  const slide = document.createElement('input');
  slide.id = 'free-slider'; slide.type = 'range'; slide.min = '0'; slide.max = '100'; slide.step = '1';
  const sliderGroup = label('滑片 P', 'label', 'sandbox-slider');
  const resistance = label('', 'output');
  sliderGroup.append(slide, resistance);
  const ohmsInput = document.createElement('input');
  ohmsInput.type = 'number'; ohmsInput.min = '0'; ohmsInput.max = '9999'; ohmsInput.step = '1';
  const ohmsGroup = label('电阻箱 Ω ', 'label', 'sandbox-slider');
  ohmsGroup.append(ohmsInput);
  const wireCount = label('0 根导线', 'output', 'sandbox-count');
  wireCount.id = 'free-wire-count';
  tools.append(wireCount, switchButton, sliderGroup, ohmsGroup, sideView, rotate, remove, removeCable, undo, clear);
  const inspector = document.querySelector('.inspector');
  const sections = inspector.querySelectorAll('.inspector-section');
  sections[0].hidden = sections[1].hidden = sections[4].hidden = true;
  const canvasStatus = label('', 'output', 'sandbox-canvas-status');
  canvasStatus.setAttribute('role', 'status');
  tools.after(canvasStatus);
  const diagram = createLiveDiagram(diagramToggle);
  inspector.insertBefore(diagram.panel, sections[1]);
  const live = document.createElement('section');
  live.className = 'inspector-section';
  const devicesList = label('', 'div', 'sandbox-device-list');
  const parameter = label('', 'p', 'sandbox-parameter');
  live.append(label('器材参数', 'h3'), devicesList, parameter);
  inspector.insertBefore(live, diagram.panel);
  const wireList = document.createDocumentFragment();
  const tasks = document.createElement('details');
  tasks.className = 'inspector-section sandbox-task';
  const loads = control('载入示例', 'free-example', 'layout-template');
  const guided = document.createElement('a');
  guided.className = 'btn btn-ghost';
  guided.href = '?id=' + experiment.id + '&mode=guided';
  guided.textContent = '进入引导实验';
  const taskActions = label('', 'div', 'sandbox-task-actions');
  taskActions.append(loads, guided);
  tasks.append(label(experiment.title, 'summary'), label('改变定值电阻两端的电压，比较通过它的电流。', 'p', 'step-detail'), taskActions);
  const modelList = document.createElement('section');
  modelList.className = 'inspector-section sandbox-models';
  modelList.append(label('实验模型', 'h3'), tasks);
  inspector.append(modelList);

  const scene = new T.Scene();
  scene.background = new T.Color(0xecf0f2);
  const renderer = new T.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.7));
  setupSandboxLighting(T, scene, renderer);
  const grid = new T.GridHelper(1, 96, 0xc9d5dc, 0xd4dfe4);
  grid.position.y = -.001;
  scene.add(grid);
  const objects = new T.Group(), cables = new T.Group();
  scene.add(objects, cables);
  const camera = new T.OrthographicCamera(-1, 1, 1, -1, .01, 20);
  const raycaster = new T.Raycaster(), floor = new T.Plane(new T.Vector3(0, 1, 0));
  const size = new T.Vector2();
  const box = new T.BoxHelper(new T.Object3D(), 0x26765f);
  box.visible = false;
  scene.add(box);
  const devices = new Map(), terminals = new Map(), counts = new Map(), wires = [];
  const touches = new Map();
  const center = new T.Vector3(0, .012, 0);
  const horizontalRight = new T.Vector3(), horizontalUp = new T.Vector3();
  const worldScale = new T.Vector2();
  const line = label('', 'div', 'circuit-drag-line');
  line.hidden = true;
  overlay.append(line);
  const categories = { power: '电源', switch: '开关与调节', rheostat: '开关与调节', ammeter: '仪表', voltmeter: '仪表', resistor: '电阻' };
  const definitions = new Map([...experiment.instruments, ...(experiment.sandboxInstruments ?? [])].map(def => [def.id, def]));
  const partFor = Object.fromEntries(Object.entries(experiment.circuit.parts).map(([k, value]) => [value.instrumentId, { ...value, role: k }]));
  let mode = 'move', selected, source, pendingKind, held, terminalDrag, leverDrag, libraryDrag, animation, busy = false;
  let theta = .10, phi = .69, zoom = 1;
  let nextWire = 0, focusWire, pinching = false, lockedView = false;
  const materials = {
    positive: new T.MeshStandardMaterial({ color: 0xaf3a36, roughness: .61 }),
    negative: new T.MeshStandardMaterial({ color: 0x273742, roughness: .61 }),
    measurement: new T.MeshStandardMaterial({ color: 0x147193, roughness: .61 }),
    selected: new T.MeshStandardMaterial({ color: 0xe49629, roughness: .55 })
  };

  const frame = () => {
    const { clientWidth: width, clientHeight: height } = canvas;
    if (!width || !height) return;
    if (size.x !== width || size.y !== height) {
      size.set(width, height);
      renderer.setSize(width, height, false);
    }
    const aspect = width / height, half = Math.max(.43, .69 / aspect) * zoom;
    Object.assign(camera, { left: -half * aspect, right: half * aspect, top: half, bottom: -half });
    const distance = Math.max(3, half * 8);
    camera.far = distance * 2.5;
    camera.position.setFromSphericalCoords(distance, phi, theta).add(center);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const groundHeight = half / Math.max(.1, Math.cos(phi));
    const step = .04 * 2 ** Math.max(0, Math.ceil(Math.log2(Math.max(half * aspect, groundHeight) / 1.6)));
    grid.position.x = Math.floor(center.x / step) * step;
    grid.position.z = Math.floor(center.z / step) * step;
    grid.scale.setScalar(step * 96);
    horizontalRight.set(Math.cos(theta), 0, -Math.sin(theta));
    horizontalUp.set(-Math.sin(theta), 0, -Math.cos(theta));
    worldScale.set(half * 2 * aspect / width, 2 * groundHeight / height);
    const item = devices.get(selected);
    box.visible = Boolean(item && mode === 'move');
    if (box.visible) box.setFromObject(item.group);
    renderer.render(scene, camera);
    const visibleTargets = [];
    for (const item of devices.values()) {
      if (!item.handle) continue;
      const p = item.motion.getWorldPosition(new T.Vector3());
      if (item.kind === 'switch') p.copy(item.motion.localToWorld(new T.Vector3(.053, 0, 0)));
      p.project(camera);
      item.handle.hidden = Boolean(pendingKind) || Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || Math.abs(p.z) > 1;
      const x = (p.x + 1) * width / 2;
      const y = (1 - p.y) * height / 2;
      item.handle.style.left = x + 'px';
      item.handle.style.top = y + 'px';
      if (!item.handle.hidden) visibleTargets.push({ button: item.handle, x, y });
    }
    for (const terminal of terminals.values()) {
      const projected = world(terminal).project(camera);
      const x0 = (projected.x + 1) * width / 2, y0 = (1 - projected.y) * height / 2;
      const shown = !pendingKind && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 && Math.abs(projected.z) <= 1;
      terminal.button.hidden = !shown;
      if (!shown) continue;
      terminal.x = x0; terminal.y = y0;
      terminal.button.style.left = x0 + 'px';
      terminal.button.style.top = y0 + 'px';
      visibleTargets.push(terminal);
    }
    sizeTerminalTargets(visibleTargets);
  };

  function world(terminal) { return terminal.device.group.localToWorld(new T.Vector3().fromArray(terminal.coords)); }
  function locationOf(event) {
    const r = canvas.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX >= r.right || event.clientY < r.top || event.clientY >= r.bottom) return null;
    raycaster.setFromCamera(new T.Vector2(2 * (event.clientX - r.left) / r.width - 1, 1 - 2 * (event.clientY - r.top) / r.height), camera);
    return raycaster.ray.intersectPlane(floor, new T.Vector3());
  }
  function inBench(point) { return point && Number.isFinite(point.x) && Number.isFinite(point.z); }
  function pan(dx, dy, base = center) {
    center.copy(base).addScaledVector(horizontalRight, -dx * worldScale.x).addScaledVector(horizontalUp, dy * worldScale.y);
  }
  function fitView() {
    theta = .10; phi = .69; zoom = 1;
    center.set(0, .012, 0);
    if (!devices.size) return;
    const bounds = new T.Box3().setFromObject(objects);
    if (wires.length) bounds.expandByObject(cables);
    const span = bounds.getSize(new T.Vector3());
    bounds.getCenter(center); center.y = .012;
    const aspect = Math.max(.2, size.x / size.y);
    const half = Math.max(.43, .69 / aspect);
    zoom = Math.max(1, Math.min(maxZoom, Math.max(span.x / (half * 1.66 * aspect), span.z / (half * 1.65))));
  }
  frontView.addEventListener('click', () => { if (!lockedView) { fitView(); frame(); } });
  viewLock.addEventListener('click', () => {
    lockedView = !lockedView;
    viewLock.setAttribute('aria-pressed', String(lockedView));
    viewLock.title = lockedView ? '解锁视角' : '锁定视角';
    for (const id of ['turn-view', 'zoom-in', 'zoom-out', 'reset-view', 'free-front-view', 'free-side-view']) el(id).disabled = lockedView;
    player.toggleAttribute('data-view-locked', lockedView);
  });
  diagramToggle.addEventListener('click', () => {
    diagram.toggle();
    diagram.update([...devices.values()], wires, terminals);
  });
  function modeTo(next) {
    mode = next;
    if (mode === 'wire') chooseLibrary();
    player.dataset.mode = next;
    moveMode.setAttribute('aria-pressed', String(mode === 'move'));
    wireMode.setAttribute('aria-pressed', String(mode === 'wire'));
    panMode.setAttribute('aria-pressed', String(mode === 'pan'));
    clearSource();
    frame();
  }
  function clearSource() {
    source = undefined;
    terminalDrag = undefined;
    line.hidden = true;
    for (const terminal of terminals.values()) {
      terminal.button.setAttribute('aria-pressed', 'false');
      terminal.button.removeAttribute('data-target');
    }
  }
  function chooseLibrary(kind) {
    pendingKind = kind;
    for (const button of el('instruments').querySelectorAll('[data-add-device]')) {
      button.setAttribute('aria-pressed', String(button.dataset.addDevice === kind));
    }
    player.toggleAttribute('data-placing', Boolean(kind));
    frame();
  }
  function select(id) {
    selected = devices.has(id) ? id : undefined;
    syncControls();
    frame();
  }
  function syncControls() {
    const item = devices.get(selected);
    live.hidden = !item;
    clear.disabled = !devices.size;
    rotate.hidden = sideView.hidden = remove.hidden = !item;
    switchButton.hidden = !['switch','switch-spdt'].includes(item?.kind);
    if (!switchButton.hidden) {
      const text = item.kind === 'switch-spdt' ? ['切至左', '切至右', '置中断开'][item.throw] : item.closed ? '断开开关' : '闭合开关';
      if (switchButton.lastChild?.nodeType === Node.TEXT_NODE) switchButton.lastChild.textContent = text;
      else switchButton.append(text);
      switchButton.setAttribute('aria-pressed', String(item.closed));
    }
    sliderGroup.hidden = !item || !Object.hasOwn(variableResistance, item.kind);
    if (!sliderGroup.hidden) {
      slide.value = String(Math.round(item.position * 100));
      resistance.textContent = Math.round(item.position * variableResistance[item.kind]) + ' Ω（A–滑片）';
    }
    ohmsGroup.hidden = item?.kind !== 'resistance-box';
    if (!ohmsGroup.hidden && document.activeElement !== ohmsInput) ohmsInput.value = String(item.ohms);
    undo.disabled = !wires.length;
    wireCount.textContent = wires.length + ' 根导线';
    wireCount.dataset.count = String(wires.length);
    el('assembly-count').textContent = String(devices.size);
    for (const device of devices.values()) {
      device.button.setAttribute('aria-pressed', String(device.id === selected));
      device.row.hidden = device.id !== selected;
    }
    if (item) {
      const facts = { power: '6 V 直流电源', resistor: '定值 10 Ω', 'battery-single': '1.5 V', 'battery-pack': '3 V',
        'lamp-bulb': '等效电阻 30 Ω', led: '正向压降约 1.8 V', 'resistance-wire': '等效电阻 11 Ω',
        'joule-calorimeter': '加热电阻 10 Ω', solenoid: '线圈等效电阻 10 Ω', 'motor-fan': '等效电阻 15 Ω',
        'motor-bare': '等效电阻 15 Ω', buzzer: '等效电阻 100 Ω', bell: '等效电阻 100 Ω' };
      parameter.textContent = range[item.kind] ? '量程 ' + (item.kind === 'galvanometer' ? '±3' : '0–' + range[item.kind]) + ' ' + unit[item.kind]
        : item.kind === 'switch' ? (item.closed ? '已闭合' : '已断开')
        : item.kind === 'switch-spdt' ? ['已断开', '左侧接通', '右侧接通'][item.throw]
        : item.kind === 'resistance-box' ? item.ohms + ' Ω'
        : Object.hasOwn(variableResistance, item.kind) ? 'A 至滑片 ' + Math.round(item.position * variableResistance[item.kind]) + ' Ω'
        : facts[item.kind] ?? '';
      parameter.hidden = !parameter.textContent;
    }
    for (const device of devices.values()) {
      if (!device.handle) continue;
      if (['switch','switch-spdt'].includes(device.kind)) device.handle.setAttribute('aria-pressed', String(device.closed || device.throw > 0));
      else device.handle.setAttribute('aria-valuenow', String(Math.round(device.position * 100)));
    }
  }
  function solve() {
    const { readings, currents, shorted } = solveSandbox([...devices.values()], wires.map(w => w.ends));
    for (const device of devices.values()) {
      const { id, kind, part, motion, original } = device;
      if (range[kind]) {
        const value = readings[id];
        const valid = Number.isFinite(value);
        const displayValue = kind === 'galvanometer' ? value * 1000 : value;
        const number = valid ? Math.abs(displayValue) < .005 ? '0.00' : displayValue.toFixed(2) : '—';
        device.output.textContent = number + ' ' + unit[kind];
        device.output.dataset.reading = valid ? String(value) : '';
        device.output.dataset.state = !valid ? 'fault' : value < -.005 ? 'reverse' : value > range[kind] + .00001 ? 'overload' : 'normal';
        device.output.title = { fault: '电源保护', reverse: '极性反接', overload: '超过表盘量程', normal: '' }[device.output.dataset.state];
        device.goal = valid ? clamp(value / range[kind], kind === 'galvanometer' ? -1 : -.038, 1) : 0;
      } else if (kind === 'switch-spdt' && motion) {
        motion.quaternion.copy(original);
        motion.rotateOnAxis(new T.Vector3(0, 0, 1), [ -Math.PI / 2, 0, -Math.PI ][device.throw]);
      } else if (motion && part?.rotate) {
        motion.quaternion.copy(original);
        motion.rotateOnAxis(new T.Vector3().fromArray(part.rotate.axis), kind === 'potentiometer' ? part.rotate.arc * device.position : device.closed ? part.rotate.arc : 0);
      } else if (motion && part?.position) {
        const { axis, min, max } = part.position;
        motion.position[axis] = T.MathUtils.lerp(min, max, device.position);
      }
      const signedCurrent = currents[id] ?? 0, current = Math.abs(signedCurrent);
      device.active = current > (kind === 'led' ? .001 : .005);
      if (device.glow) device.glow.visible = device.active;
      updateSandboxLighting(device, signedCurrent);
      if (kind.startsWith('motor-')) device.targetSpeed = device.active ? clamp(signedCurrent * 105, -60, 60) : 0;
      if (device.effectOutput) device.effectOutput.textContent = device.active ? (kind === 'joule-calorimeter' ? (current ** 2 * SANDBOX_ELECTRICAL.calorimeterOhms).toFixed(2) + ' W' : '通电') : '断电';
    }
    feedback(shorted.length ? '电源短路或过流，已停止该电路供电。' : devices.size ? '台面就绪' : '台面为空', shorted.length ? 'wrong' : 'ok');
    player.dataset.fault = shorted.length ? 'short-circuit' : '';
    canvasStatus.textContent = shorted.length ? '电源短路或过流，已停止该电路供电。' : '';
    canvasStatus.hidden = !shorted.length;
    diagram.update([...devices.values()], wires, terminals);
    syncControls();
    animate();
  }
  function animate() {
    if (animation) cancelAnimationFrame(animation);
    const instantaneous = reduced();
    let last = performance.now() - 16;
    function tick(now = performance.now()) {
      animation = undefined;
      const dt = clamp((now - last) / 1000, 0, .04);
      last = now;
      let moving = false;
      for (const device of devices.values()) {
        if (device.actuator && !instantaneous) {
          const axis = new T.Vector3().fromArray(device.part.axis);
          if (device.kind === 'bell') {
            device.actuator.quaternion.copy(device.actuatorHome);
            if (device.active) device.actuator.rotateOnAxis(axis, .26 * Math.sin(now / 24));
            moving ||= device.active;
          } else {
            device.speed += ((device.targetSpeed ?? 0) - device.speed) * (1 - Math.exp(-dt * 5.5));
            if (Math.abs(device.speed) < .045 && !device.targetSpeed) device.speed = 0;
            device.actuator.rotateOnAxis(axis, device.speed * dt);
            moving ||= device.speed !== 0 || Boolean(device.targetSpeed);
          }
        }
        if (device.goal === undefined || !device.motion) continue;
        device.needle = instantaneous || Math.abs(device.goal - device.needle) < .001
          ? device.goal : T.MathUtils.lerp(device.needle, device.goal, .27);
        moving ||= device.needle !== device.goal;
        device.motion.quaternion.copy(device.original);
        device.motion.rotateOnAxis(new T.Vector3().fromArray(device.part.rotate.axis), device.part.rotate.arc * device.needle);
      }
      frame();
      if (moving) animation = requestAnimationFrame(tick);
    }
    tick();
  }
  function available(point, device) {
    return [...devices.values()].every(other => other === device ||
      Math.abs(other.group.position.x - point.x) >= (device.width + other.width) / 2 + .012 ||
      Math.abs(other.group.position.z - point.z) >= (device.depth + other.depth) / 2 + .012);
  }
  function defaultPoint(item) {
    const gap = Math.max(.14, item.width + .04, item.depth + .04);
    for (let ring = 0; ; ring++) for (let z = -ring; z <= ring; z++) for (let x = -ring; x <= ring; x++) {
      if (Math.max(Math.abs(x), Math.abs(z)) !== ring) continue;
      const spot = new T.Vector3(center.x + x * gap, 0, center.z + z * gap);
      if (available(spot, item)) return spot;
    }
  }
  function add(kind, at) {
    const def = definitions.get(kind);
    const key = def.assetId + '@' + def.assetVersion;
    const asset = assets.get(key);
    const group = new T.Group();
    group.add(models.get(key).clone(true));
    const dimensions = new T.Box3().setFromObject(group).getSize(new T.Vector3());
    const ordinal = (counts.get(kind) ?? 0) + 1;
    const id = kind + '-' + ordinal;
    const part = def.part ?? partFor[kind];
    const motion = part && group.getObjectByName(part.node);
    if (part?.node && !motion) throw new Error('缺少活动部件：' + part.node);
    const item = { id, kind, group, part, motion, original: motion?.quaternion.clone(), closed: false,
      position: .5, needle: 0, throw: 0, ohms: SANDBOX_ELECTRICAL.resistanceBoxDefaultOhms,
      width: dimensions.x, depth: dimensions.z, name: def.label + ' ' + ordinal };
    if (part?.glow) { item.glow = group.getObjectByName(part.glow); if (item.glow) item.glow.visible = false; }
    if (part?.actuator) {
      item.actuator = group.getObjectByName(part.actuator);
      item.actuatorHome = item.actuator?.quaternion.clone();
      item.speed = 0;
    }
    const dial = kind.startsWith('multimeter-') && group.getObjectByName('MultimeterSelector');
    if (dial) dial.rotateY(kind === 'multimeter-current' ? Math.PI / 2 : -Math.PI / 2);
    const point = at ?? defaultPoint(item);
    if (!inBench(point) || !available(point, item)) { feedback('此处没有足够的摆放空间。', 'wrong'); return; }
    counts.set(kind, ordinal);
    group.position.set(point.x, 0, point.z);
    group.userData.device = id;
    objects.add(group);
    addSandboxLighting(T, item);
    const row = label('', 'div', 'sandbox-device-row');
    row.dataset.device = id;
    item.row = row;
    const pick = control(item.name, null, null, 'sandbox-device-pick');
    pick.dataset.selectDevice = id;
    pick.addEventListener('click', () => select(id));
    item.button = pick;
    row.append(pick);
    if (range[kind]) {
      item.output = label('0.00 ' + unit[kind], 'output');
      item.output.dataset.meter = id;
      row.append(item.output);
    } else if (def.category === '用电器') {
      item.effectOutput = label('断电', 'output');
      row.append(item.effectOutput);
    }
    devicesList.append(row);
    devices.set(id, item);
    bindHandle(item);
    const portDefs = def.ports ? Object.entries(def.ports).map(([p, mark]) => [kind + ':' + p, { mark, anchor: p, label: mark + '接线柱' }])
      : Object.entries(experiment.circuit.terminals).filter(([ref]) => ref.startsWith(kind + ':'));
    for (const [ref, info] of portDefs) {
      const port = id + ref.slice(kind.length);
      const button = control('');
      button.className = 'circuit-terminal';
      button.dataset.terminal = port;
      button.dataset.mark = info.mark;
      button.setAttribute('aria-label', item.name + ' · ' + info.label);
      button.title = button.getAttribute('aria-label');
      button.setAttribute('aria-pressed', 'false');
      const terminal = { port, device: item, coords: asset.anchors[info.anchor], name: item.name + ' ' + info.mark, button };
      terminals.set(port, terminal);
      overlay.append(button);
      bindTerminal(terminal);
    }
    selected = id;
    redrawWires(id);
    if (!busy) solve();
    return item;
  }
  function move(item, at) {
    item.group.position.set(at.x, 0, at.z);
    redrawWires(item.id);
    frame();
  }
  function updateWire() {
    const route = createCableRouter([...devices.values()].map(item => ({ group: item.group, faceFront: Boolean(range[item.kind]) })));
    const endpoint = port => {
      const terminal = terminals.get(port);
      return { group: terminal.device.group, position: world(terminal) };
    };
    const paths = wires.map(wire => route(...wire.ends.map(endpoint), wire.via));
    const stack = buildCableStack(paths);
    for (const [i, wire] of wires.entries()) {
      const curve = stack[i];
      wire.mesh.geometry.dispose();
      wire.mesh.geometry = new T.TubeGeometry(curve, clamp(Math.ceil(paths[i].getLength() / .005), 50, 420), .0028, 8, false);
      wire.mesh.material = focusWire === wire ? materials.selected : wire.material;
    }
  }
  function redrawWires() { if (!busy && wires.length) updateWire(); }
  function connect(first, second, via) {
    if (first === second || !terminals.has(first) || !terminals.has(second)) return;
    const ends = pair(first, second);
    if (wires.some(w => w.ends[0] === ends[0] && w.ends[1] === ends[1])) {
      clearSource();
      feedback('这两个接线柱已经相连。', 'wrong');
      return;
    }
    const material = ends.some(port => port.startsWith('voltmeter-')) ? materials.measurement
      : ends.some(port => port.startsWith('power-') && port.endsWith(':n')) ? materials.negative : materials.positive;
    const mesh = new T.Mesh(new T.BufferGeometry(), material);
    mesh.userData.wire = ++nextWire;
    cables.add(mesh);
    const row = label('', 'div', 'sandbox-wire-row');
    const name = ends.map(port => terminals.get(port).name).join(' ↔ ');
    const pick = control(name, null, null, 'sandbox-wire-pick');
    const del = control('', null, 'x', 'icon-btn');
    del.dataset.deleteWire = String(nextWire);
    del.title = '移除导线：' + name;
    del.setAttribute('aria-label', del.title);
    row.append(pick, del);
    wireList.append(row);
    const wire = { id: nextWire, ends, mesh, row, material,
      via: first === ends[0] ? via : via?.slice().reverse() };
    pick.addEventListener('click', () => chooseWire(wire));
    del.addEventListener('click', () => { cut(wire); solve(); });
    wires.push(wire);
    if (!busy) updateWire();
    clearSource();
    if (!busy) { solve(); window.lucide?.createIcons(); }
  }
  function chooseWire(wire) {
    if (focusWire) {
      focusWire.mesh.material = focusWire.material;
      focusWire.row.removeAttribute('data-selected');
    }
    focusWire = wire;
    if (wire) {
      wire.mesh.material = materials.selected;
      wire.row.dataset.selected = '';
    }
    removeCable.hidden = !wire;
    frame();
  }
  function cut(wire) {
    if (!wire) return;
    if (focusWire === wire) chooseWire();
    wires.splice(wires.indexOf(wire), 1);
    wire.row.remove();
    cables.remove(wire.mesh);
    wire.mesh.geometry.dispose();
    if (!busy) updateWire();
  }
  function erase(id) {
    const item = devices.get(id);
    if (!item) return;
    for (const wire of [...wires]) if (wire.ends.some(port => terminals.get(port).device === item)) cut(wire);
    for (const [key, terminal] of terminals) if (terminal.device === item) {
      terminal.button.remove(); terminals.delete(key);
    }
    objects.remove(item.group);
    disposeSandboxLighting(item);
    item.row.remove();
    item.handle?.remove();
    devices.delete(id);
    redrawWires(id);
    if (selected === id) selected = undefined;
    clearSource();
    if (!busy) solve();
  }
  function reset() {
    busy = true;
    chooseLibrary();
    for (const id of [...devices.keys()]) erase(id);
    counts.clear();
    if (!lockedView) fitView();
    modeTo('move');
    busy = false;
    solve();
  }
  function chooseTerminal(terminal) {
    if (pendingKind) return;
    if (source === terminal.port) clearSource();
    else if (source) connect(source, terminal.port);
    else {
      source = terminal.port;
      terminal.button.setAttribute('aria-pressed', 'true');
    }
  }
  function bindTerminal(terminal) {
    const { button } = terminal;
    button.addEventListener('click', event => { if (event.detail === 0) chooseTerminal(terminal); });
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0 || pendingKind || terminalDrag) return;
      // Touch adjustment can target an adjacent button even when the pointer is on the canvas.
      if (event.pointerType === 'touch' && document.elementFromPoint(event.clientX, event.clientY) === canvas) {
        beginCanvasGesture(event);
        return;
      }
      terminalDrag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false, from: terminal.port };
      button.setPointerCapture(event.pointerId);
    });
    button.addEventListener('pointermove', event => {
      if (terminalDrag?.pointer !== event.pointerId) return;
      if (Math.hypot(terminalDrag.x - event.clientX, terminalDrag.y - event.clientY) > 5) terminalDrag.moved = true;
      if (!terminalDrag.moved) return;
      terminalDrag.target = nearestTerminal(event, terminal.port);
      for (const entry of terminals.values()) entry.button.toggleAttribute('data-target', entry.port === terminalDrag.target);
      const b = overlay.getBoundingClientRect();
      const x = event.clientX - b.left - terminal.x, y = event.clientY - b.top - terminal.y;
      line.hidden = false;
      line.style.left = terminal.x + 'px'; line.style.top = terminal.y + 'px';
      line.style.width = Math.hypot(x, y) + 'px';
      line.style.transform = 'rotate(' + Math.atan2(y, x) + 'rad)';
    });
    button.addEventListener('pointerup', event => {
      if (terminalDrag?.pointer !== event.pointerId) return;
      const moved = terminalDrag.moved;
      const target = nearestTerminal(event, terminal.port);
      terminalDrag = undefined;
      line.hidden = true;
      for (const entry of terminals.values()) entry.button.removeAttribute('data-target');
      if (!moved) return chooseTerminal(terminal);
      if (target && target !== terminal.port) connect(terminal.port, target);
      else clearSource();
    });
    for (const event of ['pointercancel', 'lostpointercapture']) button.addEventListener(event, () => {
      if (terminalDrag) clearSource();
    });
  }
  function nearestTerminal(event, from) {
    const button = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-terminal]');
    if (button && button.dataset.terminal !== from) return button.dataset.terminal;
    const viewport = canvas.getBoundingClientRect();
    let best, distance = 23;
    for (const pin of terminals.values()) {
      if (pin.port === from || pin.button.hidden) continue;
      const delta = Math.hypot(pin.x + viewport.left - event.clientX, pin.y + viewport.top - event.clientY);
      if (delta < distance) { best = pin.port; distance = delta; }
    }
    return best;
  }
  function bindHandle(item) {
    if (!item.motion || (!['switch', 'switch-spdt'].includes(item.kind) && !Object.hasOwn(variableResistance, item.kind))) return;
    const isSwitch = ['switch', 'switch-spdt'].includes(item.kind);
    const handle = control('');
    handle.className = 'sandbox-handle';
    handle.dataset.apparatusHandle = handle.dataset.actuator = item.id;
    handle.title = isSwitch ? '拨动刀闸' : '拖动滑片';
    handle.setAttribute('aria-label', item.name + ' · ' + handle.title);
    if (!isSwitch) {
      handle.setAttribute('role', 'slider');
      handle.setAttribute('aria-valuemin', '0');
      handle.setAttribute('aria-valuemax', '100');
    }
    const change = position => {
      selected = item.id;
      if (item.kind === 'switch-spdt') item.throw = (item.throw + 1) % 3;
      else if (isSwitch) item.closed = !item.closed;
      else item.position = clamp(position, 0, 1);
      solve();
    };
    handle.addEventListener('click', event => { if (!event.detail && isSwitch) change(); });
    handle.addEventListener('keydown', event => {
      if (isSwitch) return;
      const offset = { ArrowLeft: -.05, ArrowDown: -.05, ArrowRight: .05, ArrowUp: .05 }[event.key];
      if (offset) change(item.position + offset);
      else if (event.key === 'Home') change(0);
      else if (event.key === 'End') change(1);
      else return;
      event.preventDefault();
    });
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || leverDrag) return;
      const rail = item.part.rail?.map(at => item.group.localToWorld(new T.Vector3().fromArray(at)).project(camera));
      leverDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, start: item.position, rail };
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
      if (leverDrag?.id !== event.pointerId || isSwitch) return;
      if (!leverDrag.rail) {
        change(leverDrag.start + (event.clientX - leverDrag.x) / 100);
        return;
      }
      const [a, b] = leverDrag.rail;
      const dx = (b.x - a.x) * canvas.clientWidth / 2, dy = (a.y - b.y) * canvas.clientHeight / 2;
      const length = dx * dx + dy * dy;
      if (length > 16) change(leverDrag.start + ((event.clientX - leverDrag.x) * dx + (event.clientY - leverDrag.y) * dy) / length);
    });
    handle.addEventListener('pointerup', event => {
      if (leverDrag?.id !== event.pointerId) return;
      leverDrag = undefined;
      if (isSwitch) change();
    });
    handle.addEventListener('pointercancel', event => {
      if (leverDrag?.id !== event.pointerId) return;
      const position = leverDrag.start;
      leverDrag = undefined;
      if (!isSwitch) change(position);
    });
    item.handle = handle;
    overlay.append(handle);
  }
  function hitDevice() {
    for (const hit of raycaster.intersectObjects(objects.children, true)) {
      let node = hit.object;
      while (node && !node.userData.device) node = node.parent;
      if (node) return devices.get(node.userData.device);
    }
  }
  const shortcuts = { ArrowLeft: [-.02, 0], ArrowRight: [.02, 0], ArrowUp: [0, -.02], ArrowDown: [0, .02] };
  canvas.tabIndex = 0;
  canvas.addEventListener('keydown', e => {
    if (e.key === 'Enter' && pendingKind) {
      if (add(pendingKind)) chooseLibrary();
      e.preventDefault();
      return;
    }
    const item = devices.get(selected), offset = shortcuts[e.key];
    if (!offset || !item || mode !== 'move') return;
    const at = item.group.position.clone().add(new T.Vector3(offset[0], 0, offset[1]));
    if (inBench(at) && available(at, item)) move(item, at);
    e.preventDefault();
  });
  function beginCanvasGesture(event) {
    if (event.pointerType === 'touch') {
      touches.set(event.pointerId, new T.Vector2(event.clientX, event.clientY));
      if (touches.size > 1) {
        pinching = true;
        if (held?.item) move(held.item, held.start);
        held = undefined;
        canvas.setPointerCapture(event.pointerId);
        return;
      }
    }
    if (![0, 1, 2].includes(event.button) || held) return;
    const at = locationOf(event);
    if (!at) return;
    const navigation = event.button !== 0 || event.shiftKey;
    const item = !navigation && hitDevice();
    const wire = !item && wires.find(w => w.id === raycaster.intersectObjects(cables.children).at(0)?.object.userData.wire);
    held = { id: event.pointerId, item: !pendingKind ? item : undefined, hit: item, wire,
      orbit: mode !== 'pan' && event.button !== 1 && !event.shiftKey, center: center.clone(),
      priorRoute: wire?.via,
      start: item?.group.position.clone(), at, x: event.clientX, y: event.clientY, theta, phi, moved: false };
    canvas.setPointerCapture(event.pointerId);
  }
  canvas.addEventListener('pointerdown', beginCanvasGesture);
  canvas.addEventListener('pointermove', event => {
    if (touches.has(event.pointerId)) {
      const before = touches.size === 2 ? separation() : undefined;
      touches.get(event.pointerId).set(event.clientX, event.clientY);
      if (before && !lockedView) {
        const after = separation();
        pan(after.x - before.x, after.y - before.y);
        zoom = clamp(zoom * before.distance / Math.max(1, after.distance), minZoom, maxZoom);
        frame();
      }
      if (pinching) return;
    }
    if (held?.id !== event.pointerId) return;
    const dx = event.clientX - held.x, dy = event.clientY - held.y;
    if (!held.moved && Math.hypot(dx, dy) < 5) return;
    held.moved = true;
    if (held.item) {
      const at = locationOf(event);
      if (at) move(held.item, at.sub(held.at).add(held.start));
    } else if (held.wire && mode === 'wire' && !pendingKind) {
      const at = locationOf(event);
      if (inBench(at)) {
        held.wire.via = [[at.x, at.z]];
        chooseWire(held.wire);
        updateWire(held.wire);
        frame();
      }
    } else if (held.orbit && !lockedView) {
      theta = held.theta - dx * .009;
      phi = clamp(held.phi - dy * .008, .18, 1.47);
      frame();
    } else if (!lockedView) {
      pan(dx, dy, held.center);
      frame();
    }
  });
  canvas.addEventListener('pointerup', event => {
    touches.delete(event.pointerId);
    if (pinching) { if (!touches.size) pinching = false; return; }
    if (held?.id !== event.pointerId) return;
    const drag = held;
    held = undefined;
    if (drag.moved && drag.item && (!locationOf(event) || !available(drag.item.group.position, drag.item))) {
      move(drag.item, drag.start);
      feedback('器材需要放在台面空处。', 'wrong');
    }
    if (pendingKind && !drag.moved) {
      const at = locationOf(event);
      if (inBench(at) && add(pendingKind, at)) chooseLibrary();
    } else if (drag.hit) select(drag.hit.id);
    else if (!drag.moved && drag.wire) chooseWire(drag.wire);
    else if (!drag.moved) { clearSource(); chooseWire(); }
  });
  function separation() {
    const [a, b] = touches.values();
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: a.distanceTo(b) };
  }
  canvas.addEventListener('pointercancel', event => {
    touches.delete(event.pointerId);
    if (!touches.size) pinching = false;
    if (held?.item) move(held.item, held.start);
    if (held?.wire && held.moved) {
      held.wire.via = held.priorRoute;
      updateWire(held.wire);
      frame();
    }
    held = undefined;
  });
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  canvas.addEventListener('dblclick', event => {
    if (!locationOf(event)) return;
    const item = hitDevice();
    if (item?.kind !== 'switch' && item?.kind !== 'switch-spdt') return;
    selected = item.id;
    if (item.kind === 'switch') item.closed = true;
    else if (!item.throw) item.throw = 1;
    solve();
  });
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    if (lockedView) return;
    const point = locationOf(event);
    zoom = clamp(zoom * Math.exp(event.deltaY * .001), minZoom, maxZoom);
    frame();
    if (point) center.add(point.sub(locationOf(event) ?? point));
    frame();
  }, { passive: false });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { clearSource(); chooseLibrary(); chooseWire(); }
    if (event.key === 'Delete' && focusWire && !['INPUT', 'TEXTAREA'].includes(event.target.tagName)) { cut(focusWire); solve(); }
  });
  const library = el('instruments');
  const libraryFilter = document.createElement('input');
  libraryFilter.type = 'search'; libraryFilter.placeholder = '搜索器材';
  libraryFilter.setAttribute('aria-label', '搜索器材');
  const filters = label('', 'div', 'sandbox-library-filter');
  filters.append(libraryFilter);
  library.before(filters);
  const groups = new Map();
  const ordered = ['电源', '开关与调节', '电阻', '用电器', '仪表'].flatMap(group =>
    [...definitions].filter(([id, def]) => (def.category ?? categories[id]) === group));
  for (const [kind, definition] of ordered) {
    const category = definition.category ?? categories[kind];
    if (!groups.has(category)) {
      const heading = label(category, 'div', 'sandbox-library-group');
      groups.set(category, { heading, buttons: [] });
      library.append(heading);
    }
    const asset = assets.get(definition.assetId + '@' + definition.assetVersion);
    const button = control('');
    button.className = 'instrument';
    button.dataset.addDevice = kind;
    button.dataset.instrumentId = kind;
    button.setAttribute('aria-pressed', 'false');
    const icon = new Image();
    icon.src = localUrl(asset.preview).href;
    icon.alt = '';
    icon.draggable = false;
    button.append(icon, label(definition.label));
    library.append(button);
    groups.get(category).buttons.push(button);
    button.addEventListener('dragstart', event => event.preventDefault());
    let suppress = false;
    button.addEventListener('click', event => {
      if (!suppress) {
        modeTo('move');
        chooseLibrary(pendingKind === kind ? undefined : kind);
        if (event.detail === 0 && pendingKind) canvas.focus({ preventScroll: true });
      }
      suppress = false;
    });
    button.addEventListener('pointerdown', event => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      suppress = false;
      libraryDrag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      button.setPointerCapture(event.pointerId);
    });
    button.addEventListener('pointerup', event => {
      if (libraryDrag?.id !== event.pointerId) return;
      if (Math.hypot(event.clientX - libraryDrag.x, event.clientY - libraryDrag.y) > 7) {
        suppress = true;
        const point = locationOf(event);
        if (inBench(point)) { modeTo('move'); chooseLibrary(); add(kind, point); }
      }
      libraryDrag = undefined;
    });
    button.addEventListener('pointercancel', () => { libraryDrag = undefined; });
  }
  libraryFilter.addEventListener('input', () => {
    const query = libraryFilter.value.trim().toLowerCase();
    for (const { heading, buttons } of groups.values()) {
      for (const button of buttons) button.hidden = !button.textContent.toLowerCase().includes(query) && !button.dataset.addDevice.includes(query);
      heading.hidden = buttons.every(button => button.hidden);
    }
  });
  moveMode.addEventListener('click', () => modeTo('move'));
  wireMode.addEventListener('click', () => modeTo('wire'));
  panMode.addEventListener('click', () => modeTo('pan'));
  switchButton.addEventListener('click', () => {
    const device = devices.get(selected);
    if (device?.kind === 'switch') { device.closed = !device.closed; solve(); }
    if (device?.kind === 'switch-spdt') { device.throw = (device.throw + 1) % 3; solve(); }
  });
  slide.addEventListener('input', () => {
    const device = devices.get(selected);
    if (device && Object.hasOwn(variableResistance, device.kind)) { device.position = Number(slide.value) / 100; solve(); }
  });
  ohmsInput.addEventListener('input', () => {
    const device = devices.get(selected);
    if (device?.kind === 'resistance-box' && ohmsInput.value !== '') { device.ohms = clamp(Number(ohmsInput.value), 0, 9999); solve(); }
  });
  sideView.addEventListener('click', () => {
    if (lockedView) return;
    const item = devices.get(selected);
    if (!item) return;
    modeTo('move');
    center.copy(item.group.position);
    center.y = .045;
    theta = item.group.rotation.y + Math.PI / 2;
    phi = 1.36;
    zoom = .32;
    frame();
  });
  rotate.addEventListener('click', () => {
    const device = devices.get(selected);
    if (!device) return;
    [device.width, device.depth] = [device.depth, device.width];
    if (!available(device.group.position, device)) {
      [device.width, device.depth] = [device.depth, device.width];
      feedback('转动前请留出空间。', 'wrong');
      return;
    }
    device.group.rotation.y += Math.PI / 2;
    redrawWires(device.id);
    frame();
  });
  remove.addEventListener('click', () => erase(selected));
  removeCable.addEventListener('click', () => { cut(focusWire); solve(); });
  undo.addEventListener('click', () => { cut(wires.at(-1)); solve(); });
  clear.addEventListener('click', reset);
  loads.addEventListener('click', () => {
    if (devices.size && !window.confirm('用示例电路替换当前台面？')) return;
    reset();
    busy = true;
    const inst = new Map();
    for (const { id, position } of experiment.instruments) inst.set(id, add(id, new T.Vector3().fromArray(position)).id);
    const port = ref => { const [id, terminal] = ref.split(':'); return inst.get(id) + ':' + terminal; };
    for (const [a, b] of [
      ['power:p', 'switch:p'],
      ['switch:n', 'ammeter:p'],
      ['ammeter:n', 'resistor:p'],
      ['resistor:n', 'rheostat:b'],
      ['rheostat:c', 'power:n'],
      ['voltmeter:p', 'resistor:p'], ['voltmeter:n', 'resistor:n']
    ]) connect(port(a), port(b));
    busy = false;
    updateWire();
    select(inst.get('switch'));
    solve();
    window.lucide?.createIcons();
  });
  for (const [id, act] of Object.entries({
    'turn-view': () => { theta += Math.PI / 4; phi = .91; },
    'zoom-in': () => { zoom = Math.max(minZoom, zoom / 1.2); },
    'zoom-out': () => { zoom = Math.min(maxZoom, zoom * 1.2); },
    'reset-view': fitView
  })) {
    const button = el(id);
    button.disabled = false;
    if (id === 'reset-view') { button.title = '查看全图'; button.setAttribute('aria-label', '查看全图'); }
    button.addEventListener('click', () => { act(); frame(); });
  }
  new ResizeObserver(frame).observe(canvas);
  el('load-status').hidden = true;
  modeTo('move');
  solve();
  player.dataset.ready = 'true';
}
