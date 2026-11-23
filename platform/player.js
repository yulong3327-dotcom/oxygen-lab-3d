import * as T from 'three';
import { GLTFLoader } from '../vendor/three-r160/loaders/GLTFLoader.js';
import { createAssembly } from './assembly.js';
import { createProcedure } from './procedure.js';
import { createCircuitProcedure } from './circuit-procedure.js';
import { setupSandboxLighting } from './sandbox-lighting.js';

const byId = (id) => document.getElementById(id);
const root = new URL('../', import.meta.url);
const player = byId('player');
const canvas = byId('scene');
const target = byId('target');
const status = byId('load-status');
const feedback = byId('feedback');
const recoveryButton = byId('recover-markers');
const demoButton = byId('demonstrate');
const resetButton = byId('reset-experiment');
const viewButtons = ['turn-view', 'zoom-in', 'zoom-out', 'reset-view'].map(byId);
const assetKey = (id, version) => `${id}@${version}`;

function localUrl(path) {
  const url = new URL(path, root);
  if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname)) {
    throw new Error('模型地址不在实验室目录内。');
  }
  return url;
}

async function read(path, failure) {
  const response = await fetch(localUrl(path), { cache: 'no-cache' });
  if (!response.ok) throw new Error(failure);
  const data = await response.json();
  if (data.schemaVersion !== 1) throw new Error('不支持此版本的实验配置。');
  return data;
}

function dataIcon(name) {
  const icon = document.createElement('i');
  icon.dataset.lucide = name;
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}

function textFeedback(message, state = 'ok') {
  if (feedback.textContent !== message) feedback.textContent = message;
  feedback.dataset.state = state;
  feedback.parentElement.dataset.state = state;
  const benchFeedback = byId('bench-feedback');
  benchFeedback.textContent = state === 'wrong' ? message : '';
  benchFeedback.hidden = state !== 'wrong';
}

function stateNodes(model, states, id) {
  const nodes = new Map(Object.values(states ?? {}).flat().map(name => [name, null]));
  model.traverse(node => {
    if (!nodes.has(node.name)) return;
    if (nodes.get(node.name)) throw new Error(`${id} 中的模型节点重复：${node.name}`);
    nodes.set(node.name, node);
  });
  for (const [name, node] of nodes) {
    if (!node) throw new Error(`${id} 缺少模型节点：${name}`);
  }
  return nodes;
}

function start(experiment, assetCatalog, modelByAsset) {
  const guided = Boolean(experiment.assembly?.length);
  let assembly, procedure, circuit;
  const renderer = new T.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.7));
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(38, 1, 0.01, 100);
  scene.background = new T.Color('#eff1f5');
  if (experiment.circuit) {
    player.dataset.circuit = '';
    setupSandboxLighting(T, scene, renderer);
  } else {
    const sky = new T.HemisphereLight(0xf9fcff, 0x808376, 2.1);
    scene.add(sky);
    const key = new T.DirectionalLight(0xfff5e5, 2.1);
    key.position.set(2, 4, 3);
    scene.add(key);
    const rim = new T.DirectionalLight(0xd0e4f0, 1.25);
    rim.position.set(-2, 2, -3);
    scene.add(rim);
  }

  const table = new T.Group();
  scene.add(table);
  const models = new Map();
  const assetCounts = new Map();
  const titleCounts = new Map();
  const bounds = new T.Box3();
  const animations = [];
  for (const item of experiment.instruments) {
    assetCounts.set(item.assetId, (assetCounts.get(item.assetId) ?? 0) + 1);
  }
  for (const item of experiment.instruments) {
    const key = assetKey(item.assetId, item.assetVersion);
    const group = new T.Group();
    group.name = item.id;
    group.userData.instrumentId = item.id;
    group.position.fromArray(item.position);
    group.rotation.y = item.rotationY ?? 0;
    const asset = modelByAsset.get(key).clone(true);
    const nodes = stateNodes(asset, item.states, item.id);
    for (const [name, options] of Object.entries(item.animations ?? {})) {
      const node = nodes.get(name);
      animations.push({ node, options, position: node.position.clone(), scale: node.scale.clone() });
    }
    group.add(asset);
    table.add(group);
    group.updateMatrixWorld(true);
    bounds.union(new T.Box3().setFromObject(group));

    const displayNumber = (titleCounts.get(item.assetId) ?? 0) + 1;
    titleCounts.set(item.assetId, displayNumber);
    const baseLabel = assetCatalog.get(key).title;
    const label = item.label ?? (assetCounts.get(item.assetId) > 1 ? `${baseLabel} ${displayNumber}` : baseLabel);
    let button;
    if (guided || item.interactive !== false) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'instrument';
      button.dataset.instrumentId = item.id;
      button.setAttribute('aria-pressed', 'false');
      button.append(dataIcon('box'), label);
      if (!guided) button.addEventListener('click', () => selectInstrument(item.id));
      byId('instruments').append(button);
    }
    models.set(item.id, { group, button, start: group.position.clone(), nodes, states: item.states, initialState: item.initialState, label, preview: localUrl(assetCatalog.get(key).preview).href });
  }
  for (const step of experiment.steps) {
    if (step.action.type !== 'move-to') continue;
    const model = models.get(step.action.instrumentId);
    const destination = new T.Vector3().fromArray(step.action.position);
    const movement = destination.clone().sub(model.start);
    bounds.union(new T.Box3().setFromObject(model.group).translate(movement));
  }
  const focus = bounds.getCenter(new T.Vector3());
  const span = bounds.getSize(new T.Vector3());
  const extent = Math.max(span.x, span.y, span.z, 0.1);
  const tabletopY = Math.min(0, bounds.min.y) - extent * 0.012;
  const ground = new T.Mesh(
    new T.PlaneGeometry(extent * 14, extent * 14),
    new T.MeshBasicMaterial({ color: '#eff1f5' })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(focus.x, tabletopY, focus.z);
  scene.add(ground);
  const grid = new T.GridHelper(extent * (guided ? 1.65 : 8), 34, 0xc8ced8, 0xd6dce5);
  grid.position.set(focus.x, tabletopY + extent * 0.001, focus.z);
  scene.add(grid);
  scene.fog = new T.Fog('#eff1f5', extent * 4, extent * 10);

  const outline = new T.Box3Helper(new T.Box3(), 0x208a70);
  outline.visible = false;
  scene.add(outline);
  const ray = new T.Raycaster();
  const point = new T.Vector2();
  const floor = new T.Plane(new T.Vector3(0, 1, 0));
  const targetPoint = new T.Vector3();
  const homeTheta = experiment.view?.theta ?? 0.52;
  const homePhi = experiment.view?.phi ?? 0.97;
  const homeZoom = experiment.view?.zoom ?? 1;
  const angle = new T.Spherical(1, homePhi, homeTheta);
  const offset = new T.Vector3();
  let zoom = homeZoom;
  let stepIndex = 0;
  let selected = null;
  let gesture = null;
  const touches = new Map();
  let pinch = false;
  let demoFrame = null;
  let animationFrame = null;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const showObservations = Boolean(experiment.circuit || experiment.steps.some(s => s.effects?.length));
  const stepItems = experiment.steps.map((step, index) => {
    const li = document.createElement('li');
    li.dataset.stepId = step.id;
    const badge = document.createElement('span');
    badge.className = 'step-number';
    badge.setAttribute('aria-hidden', 'true');
    badge.textContent = String(index + 1).padStart(2, '0');
    const label = document.createElement('span');
    label.textContent = step.title;
    if (showObservations) {
      const observation = document.createElement('small');
      observation.textContent = step.observable;
      label.append(observation);
    }
    const row = document.createElement('span');
    row.className = 'step-row';
    row.append(badge, label);
    li.append(row);
    byId('step-list').append(li);
    return li;
  });

  const active = () => (!guided || assembly?.complete()) ? experiment.steps[stepIndex] : undefined;
  const locked = () => demoFrame !== null;

  function setModelState(model, state) {
    if (!model.states) return;
    const visible = new Set(model.states[state]);
    for (const [name, node] of model.nodes) node.visible = visible.has(name);
    if (model.button) model.button.dataset.state = state;
  }

  function animateModels(now) {
    for (const { node, options, position, scale } of animations) {
      if (!node.visible) continue;
      const { type, periodMs, phase = 0 } = options;
      const cycle = (now / periodMs + phase) % 1;
      if (type === 'pulse') {
        const strength = 0.5 - Math.cos(cycle * Math.PI * 2) * 0.5;
        node.scale.set(...options.scale.map((target, axis) => scale.getComponent(axis) * T.MathUtils.lerp(1, target, strength)));
      } else {
        node.position.set(...options.offset.map((distance, axis) => position.getComponent(axis) + distance * cycle));
      }
    }
    updateView();
    animationFrame = requestAnimationFrame(animateModels);
  }

  function project(value) {
    const p = (Array.isArray(value) ? new T.Vector3().fromArray(value) : value.clone()).project(camera);
    return { x: (p.x + 1) * canvas.clientWidth / 2, y: (1 - p.y) * canvas.clientHeight / 2, depth: p.z,
      visible: p.z >= -1 && p.z <= 1 && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 };
  }

  function rayFrom(x, y) {
    point.set(x / canvas.clientWidth * 2 - 1, 1 - y / canvas.clientHeight * 2);
    ray.setFromCamera(point, camera);
    return ray.ray;
  }

  function syncAnimations() {
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    animationFrame = null;
    for (const { node, position, scale } of animations) {
      node.position.copy(position);
      node.scale.copy(scale);
    }
    if (!document.hidden && !reduceMotion.matches && animations.some(({ node }) => node.visible)) {
      animationFrame = requestAnimationFrame(animateModels);
    } else {
      updateView();
    }
  }

  function updateView() {
    if (canvas.clientWidth === 0 || canvas.clientHeight === 0) return;
    const ratio = canvas.clientWidth / canvas.clientHeight;
    const vertical = T.MathUtils.degToRad(camera.fov / 2);
    const horizontal = Math.atan(Math.tan(vertical) * ratio);
    const viewRadius = Math.max(span.length() / 2, extent / 2);
    const required = viewRadius / Math.sin(Math.min(vertical, horizontal)) * 1.16;
    angle.radius = required * zoom;
    camera.aspect = ratio;
    camera.near = Math.max(extent / 500, angle.radius / 250);
    camera.far = angle.radius + extent * 18;
    camera.position.copy(focus).add(offset.setFromSpherical(angle));
    camera.lookAt(focus);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    if (selected) outline.box.setFromObject(models.get(selected).group);
    outline.visible = Boolean(selected);
    renderer.render(scene, camera);
    placeTarget();
    assembly?.positionTarget();
    procedure?.render();
    circuit?.render();
    positionParts();
    recoveryButton.hidden = !(assembly?.needsView() || procedure?.needsView() || circuit?.needsView());
  }

  function placeTarget() {
    const step = active();
    if (step?.action.type !== 'move-to') {
      target.hidden = true;
      return;
    }
    targetPoint.fromArray(step.action.position).project(camera);
    target.hidden = targetPoint.z < -1 || targetPoint.z > 1 || Math.abs(targetPoint.x) > 1 || Math.abs(targetPoint.y) > 1;
    if (!target.hidden) {
      const x = (targetPoint.x + 1) * canvas.clientWidth / 2;
      const y = (1 - targetPoint.y) * canvas.clientHeight / 2;
      target.style.left = `${x}px`;
      target.style.top = `${y}px`;
    }
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    renderer.setSize(rect.width, rect.height, false);
    updateView();
  }

  function setSelection(id = null) {
    selected = id;
    if (!guided) {
      for (const [key, model] of models) model.button?.setAttribute('aria-pressed', String(key === id));
    }
    updateView();
  }

  function renderSteps() {
    const assembling = guided && !assembly?.complete();
    const done = !assembling && !active();
    stepItems.forEach((item, index) => {
      const here = !assembling && index === stepIndex;
      if (here) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
      item.classList.toggle('is-complete', index < stepIndex);
      item.dataset.stepState = index < stepIndex ? 'complete' : here ? 'current' : 'pending';
    });
    byId('progress').textContent = `${stepIndex} / ${stepItems.length}`;
    const explanation = active()?.instruction ?? (done ? experiment.conclusion ?? '实验步骤已完成。' : '');
    byId('instruction').textContent = explanation;
    player.dataset.stepIndex = String(stepIndex);
    player.dataset.complete = String(done);
    player.dataset.phase = assembling ? 'assembly' : 'operation';
    demoButton.disabled = !active() || locked();
    target.disabled = locked();
    if (!guided) for (const model of models.values()) if (model.button) model.button.disabled = !active() || locked();
    if (guided) {
      const phase = assembling ? 'assembly-phase' : 'procedure-phase';
      for (const id of ['assembly-phase', 'procedure-phase']) {
        if (id === phase) byId(id).setAttribute('aria-current', 'step');
        else byId(id).removeAttribute('aria-current');
      }
      byId('assembly-phase').toggleAttribute('data-complete', !assembling);
      resetButton.disabled = !done;
      resetButton.hidden = !done;
      byId('part-overlay').hidden = !done;
      byId('step-hint').dataset.kind = done || active()?.action.type === 'observe' ? 'observe' : 'action';
      const current = assembly?.currentSlot();
      byId('hint-title').textContent = assembling
        ? `${String(current.index + 1).padStart(2, '0')} / ${experiment.assembly.length} · ${current.label}`
        : done ? '实验完成' : `步骤 ${String(stepIndex + 1).padStart(2, '0')} / ${stepItems.length} · ${active().title}`;
      byId('hint-text').textContent = assembling ? current.hint : explanation;
    }
    setSelection();
  }

  function applyEffects(step) {
    for (const { instrumentId, state } of step.effects ?? []) setModelState(models.get(instrumentId), state);
    if (animations.length && step.effects?.length) syncAnimations();
  }

  function completeStep() {
    const step = active();
    if (!step) return;
    if (step.action.type !== 'observe') applyEffects(step);
    textFeedback(step.observable || '完成当前步骤。');
    stepIndex++;
    renderSteps();
  }

  function wrong(message) {
    const step = active();
    if (!step) return;
    setSelection();
    textFeedback(message || step.wrongFeedback || '请按当前步骤操作。', 'wrong');
  }

  function selectInstrument(id) {
    const action = active()?.action;
    if (guided || !action || locked()) return;
    if (id !== action.instrumentId) return wrong();
    if (action.type === 'select') return completeStep();
    setSelection(id);
    textFeedback('');
  }

  function moveTo(moveId) {
    const action = active()?.action;
    if (locked() || action?.type !== 'move-to') return;
    if (moveId !== action.instrumentId) return wrong();
    models.get(moveId).group.position.fromArray(action.position);
    completeStep();
  }

  function cancelGesture() {
    if (!gesture) return;
    if (gesture.group && gesture.start) gesture.group.position.copy(gesture.start);
    gesture = null;
  }

  function reset({ rebuild = false } = {}) {
    if (demoFrame !== null) cancelAnimationFrame(demoFrame);
    demoFrame = null;
    cancelGesture();
    procedure?.reset();
    stepIndex = 0;
    circuit?.reset();
    for (const model of models.values()) {
      if (!guided) model.group.position.copy(model.start);
      setModelState(model, model.initialState);
    }
    for (const { button } of partButtons) button.setAttribute('aria-pressed', 'false');
    if (rebuild) {
      homeView();
      assembly.reset();
    } else {
      textFeedback(guided ? active()?.instruction ?? '' : '请选择当前步骤的器材。');
    }
    renderSteps();
    if (animations.length) syncAnimations();
  }

  function demonstrate() {
    const action = active()?.action;
    if (!action || locked() || gesture) return;
    if (action.type === 'select') return selectInstrument(action.instrumentId);
    const model = models.get(action.instrumentId);
    const start = model.group.position.clone();
    const destination = new T.Vector3().fromArray(action.position);
    if (reduceMotion.matches) return moveTo(action.instrumentId);
    const began = performance.now();
    const animate = (now) => {
      const t = Math.min(1, (now - began) / 420);
      model.group.position.lerpVectors(start, destination, t * t * (3 - 2 * t));
      if (t === 1) {
        demoFrame = null;
        completeStep();
        return;
      }
      updateView();
      demoFrame = requestAnimationFrame(animate);
    };
    demoFrame = requestAnimationFrame(animate);
    demoButton.disabled = true;
    target.disabled = true;
    for (const entry of models.values()) if (entry.button) entry.button.disabled = true;
    setSelection(action.instrumentId);
  }

  function rayAt(e) {
    const rect = canvas.getBoundingClientRect();
    rayFrom(e.clientX - rect.left, e.clientY - rect.top);
  }

  function hitInstrument(e) {
    rayAt(e);
    for (const { object } of ray.intersectObjects(table.children, true)) {
      let node = object;
      while (node?.visible && !node.userData.instrumentId) node = node.parent;
      const id = node?.visible && node.userData.instrumentId;
      if (id && models.get(id).button) return id;
    }
    return null;
  }

  function pointerDown(e) {
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size > 1) {
        pinch = true;
        cancelGesture();
        assembly?.cancel();
        canvas.setPointerCapture(e.pointerId);
        return;
      }
    }
    if (e.button !== 0 || gesture) return;
    if (guided && !assembly.complete() && assembly.benchStart(e)) return;
    const action = active()?.action;
    const id = guided || locked() || !action ? null : hitInstrument(e);
    const group = action?.type === 'move-to' && id ? models.get(id).group : null;
    const start = group?.position.clone();
    const grabPoint = new T.Vector3();
    if (start) {
      floor.constant = -start.y;
      ray.ray.intersectPlane(floor, grabPoint);
    }
    gesture = { pointer: e.pointerId, id, group, start, grabPoint, x: e.clientX, y: e.clientY, theta: angle.theta, phi: angle.phi, moved: false };
    canvas.setPointerCapture(e.pointerId);
  }

  function pointerMove(e) {
    if (touches.has(e.pointerId)) {
      const separation = () => {
        const [a, b] = touches.values();
        return Math.hypot(a.x - b.x, a.y - b.y);
      };
      const before = touches.size > 1 ? separation() : 0;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (before > 0) zoomBy(before / Math.max(separation(), 1));
      if (pinch) return;
    }
    if (gesture?.pointer !== e.pointerId) return;
    const dx = e.clientX - gesture.x;
    const dy = e.clientY - gesture.y;
    if (!gesture.moved && Math.hypot(dx, dy) < 6) return;
    gesture.moved = true;
    if (gesture.group) {
      if (selected !== gesture.id) setSelection(gesture.id);
      rayAt(e);
      const hit = ray.ray.intersectPlane(floor, new T.Vector3());
      if (hit) gesture.group.position.copy(hit.sub(gesture.grabPoint).add(gesture.start));
    } else {
      angle.theta = gesture.theta - dx * 0.009;
      angle.phi = T.MathUtils.clamp(gesture.phi - dy * 0.008, 0.22, 1.46);
    }
    updateView();
  }

  function pointerUp(e) {
    touches.delete(e.pointerId);
    if (pinch) { if (!touches.size) pinch = false; return; }
    if (gesture?.pointer !== e.pointerId) return;
    const { id, group, start, moved } = gesture;
    gesture = null;
    if (!moved && guided && !assembly.complete()) return assembly.benchTap(e);
    if (!moved && id) return selectInstrument(id);
    if (!group) return;
    const rect = target.getBoundingClientRect();
    const nearTarget = !target.hidden && Math.hypot(e.clientX - (rect.left + rect.width / 2), e.clientY - (rect.top + rect.height / 2)) <= Math.max(rect.width / 2, 28);
    const action = active()?.action;
    const closeInScene = action?.type === 'move-to' && group.position.distanceTo(new T.Vector3().fromArray(action.position)) <= extent * 0.055;
    if ((nearTarget || closeInScene) && active()?.action.instrumentId === id) return moveTo(id);
    group.position.copy(start);
    wrong();
  }

  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('lostpointercapture', (e) => {
    touches.delete(e.pointerId);
    if (!touches.size) pinch = false;
    if (gesture?.pointer !== e.pointerId) return;
    cancelGesture();
    setSelection();
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomBy(Math.exp(T.MathUtils.clamp(e.deltaY, -450, 450) * 0.0016));
  }, { passive: false });
  function zoomBy(multiplier) {
    zoom = T.MathUtils.clamp(zoom * multiplier, 0.58, 2.8);
    updateView();
  }
  viewButtons[0].addEventListener('click', () => { angle.theta += Math.PI / 5; updateView(); });
  viewButtons[1].addEventListener('click', () => zoomBy(0.83));
  viewButtons[2].addEventListener('click', () => zoomBy(1.2));
  function homeView() { angle.theta = homeTheta; angle.phi = homePhi; zoom = homeZoom; updateView(); }
  viewButtons[3].addEventListener('click', homeView);
  recoveryButton.addEventListener('click', event => {
    homeView();
    if (event.detail === 0) {
      if (assembly?.complete()) (circuit ?? procedure).focusCurrent();
      else assembly?.focusCurrent();
    }
  });
  target.addEventListener('click', () => moveTo(selected));
  demoButton.addEventListener('click', demonstrate);
  resetButton.addEventListener('click', event => {
    reset();
    if (guided && event.detail === 0) (circuit ?? procedure).focusCurrent();
  });
  byId('reset-assembly').addEventListener('click', event => {
    reset({ rebuild: true });
    if (event.detail === 0) assembly.focusCurrent();
  });
  if (animations.length) {
    document.addEventListener('visibilitychange', syncAnimations);
    reduceMotion.addEventListener('change', syncAnimations);
  }

  function worldPoint(ref) {
    if (Array.isArray(ref)) return new T.Vector3().fromArray(ref);
    const model = models.get(ref.instrumentId);
    const config = experiment.instruments.find(item => item.id === ref.instrumentId);
    const anchor = ref.at ?? assetCatalog.get(assetKey(config.assetId, config.assetVersion)).anchors[ref.anchor];
    return model.group.localToWorld(new T.Vector3().fromArray(anchor));
  }

  function positionParts() {
    if (byId('part-overlay').hidden) return;
    const occupied = [];
    const clamp = T.MathUtils.clamp;
    for (const { button, leader, part } of partButtons) {
      const p = project(worldPoint(part));
      button.hidden = !p.visible;
      leader.hidden = !p.visible;
      if (!p.visible) continue;
      const w = button.offsetWidth + 6, h = button.offsetHeight + 6;
      let best;
      for (const offsetY of [-1.25, 1.15, -2.25, 2.15, -3.25, 3.15]) {
        for (const offsetX of [0, -.62, .62, -1.2, 1.2]) {
          const x = clamp(p.x + offsetX * w, w / 2, canvas.clientWidth - w / 2);
          const y = clamp(p.y + offsetY * h, h / 2, canvas.clientHeight - h / 2 - 34);
          const overlap = occupied.reduce((sum, box) =>
            sum + Math.max(0, (w + box.w) / 2 - Math.abs(x - box.x)) * Math.max(0, (h + box.h) / 2 - Math.abs(y - box.y)), 0);
          const score = overlap * 10 + Math.hypot(x - p.x, y - p.y);
          if (!best || score < best.score) best = { x, y, score, w, h };
        }
      }
      occupied.push(best);
      button.style.transform = `translate(${best.x}px, ${best.y}px) translate(-50%, -50%)`;
      leader.style.left = p.x + 'px';
      leader.style.top = p.y + 'px';
      leader.style.width = Math.hypot(best.x - p.x, best.y - p.y) + 'px';
      leader.style.transform = `rotate(${Math.atan2(best.y - p.y, best.x - p.x)}rad)`;
    }
  }

  const partButtons = (experiment.parts ?? []).map(part => {
    const leader = document.createElement('span');
    leader.className = 'part-leader';
    leader.setAttribute('aria-hidden', 'true');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lab-pin btn';
    button.setAttribute('aria-pressed', 'false');
    button.textContent = part.label;
    button.addEventListener('click', () => {
      const show = button.getAttribute('aria-pressed') !== 'true';
      for (const entry of partButtons) entry.button.setAttribute('aria-pressed', String(show && entry.button === button));
      byId('hint-title').textContent = show ? part.label : '实验完成';
      byId('hint-text').textContent = show ? part.detail : experiment.conclusion;
      textFeedback(show ? part.detail : experiment.conclusion);
    });
    byId('part-overlay').append(leader, button);
    return { button, leader, part };
  });
  if (guided) {
    player.dataset.guided = '';
    byId('bench-guide').hidden = false;
    for (const model of models.values()) setModelState(model, model.initialState);
    const slots = experiment.assembly.map(entry => {
      const model = models.get(entry.instrumentId);
      const config = experiment.instruments.find(item => item.id === entry.instrumentId);
      const coords = typeof entry.anchor === 'string' ? assetCatalog.get(assetKey(config.assetId, config.assetVersion)).anchors[entry.anchor] : entry.anchor;
      return { ...model, ...entry, id: entry.instrumentId, label: entry.label ?? model.label,
        parent: entry.parent ? models.get(entry.parent) : undefined,
        anchor: new T.Vector3().fromArray(coords ?? [0, 0, 0]).applyEuler(model.group.rotation) };
    });
    const library = byId('instruments');
    for (const slot of slots) library.append(slot.button);
    assembly = createAssembly({ slots, canvas, library, layer: byId('assembly-overlay'), project, ray: rayFrom,
      unproject: (x, y, depth) => new T.Vector3(2 * x / canvas.clientWidth - 1, 1 - 2 * y / canvas.clientHeight, depth).unproject(camera),
      hit: hitInstrument, feedback: textFeedback,
      focusOperation: () => circuit ? circuit.focusCurrent() : procedure.focusCurrent(),
      focusRecovery: () => recoveryButton.focus({ preventScroll: true }),
      changed: (count, picked) => {
        byId('assembly-count').textContent = `${count} / ${slots.length}`;
        byId('reset-assembly').disabled = !count && !picked;
        renderSteps();
      }
    });
    procedure = createProcedure({ canvas, layer: byId('procedure-overlay'), project: ref => project(worldPoint(ref)), active,
      complete: completeStep, wrong, observe: step => { textFeedback(step.instruction); applyEffects(step); },
      reducedMotion: reduceMotion,
      onChange: selected => { if (selected) textFeedback(active().instruction); },
      focusFallback: kind => {
        const destination = kind === 'recovery' ? recoveryButton : byId('instruction');
        destination.focus({ preventScroll: true });
      }
    });
    if (experiment.circuit) circuit = createCircuitProcedure({
      canvas, scene, models, config: experiment.circuit, active, project,
      point: worldPoint, complete: completeStep, feedback: textFeedback, update: updateView,
      overlay: byId('circuit-overlay'), controls: byId('circuit-controls'), data: byId('circuit-data')
    });
    byId('phase-list').hidden = byId('assembly-tools').hidden = false;
    byId('practice-label').hidden = true;
  } else {
    demoButton.hidden = false;
    resetButton.hidden = false;
    resetButton.disabled = false;
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  for (const button of viewButtons) button.disabled = false;
  byId('experiment-title').textContent = experiment.title;
  byId('experiment-summary').textContent = experiment.summary;
  for (const field of ['equation', 'note']) {
    const element = byId(`experiment-${field}`);
    element.textContent = experiment[field] ?? '';
    element.hidden = !experiment[field];
  }
  byId('reaction-section').hidden = !experiment.equation;
  if (experiment.circuit) {
    const brand = document.querySelector('.site-brand');
    brand.querySelector('.brand-name').textContent = '电学实验室';
    brand.setAttribute('aria-label', '返回实验室目录');
    brand.querySelector('[data-lucide]')?.replaceWith(dataIcon('zap'));
  }
  document.title = `${experiment.title} · ${experiment.circuit ? '电学实验室' : '化学实验室'}`;
  status.hidden = true;
  reset({ rebuild: guided });
  resize();
  player.dataset.ready = 'true';
}

async function load() {
  const id = new URLSearchParams(location.search).get('id');
  if (!id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error('请选择一个实验项目。');
  const [experiment, catalog] = await Promise.all([
    read(`experiments/${id}/experiment.json`, '没有找到这个实验。'),
    read('assets/catalog.json', '无法读取器材目录。')
  ]);
  if (experiment.id !== id || !experiment.instruments?.length || !experiment.steps?.length) {
    throw new Error('实验配置缺少仪器或步骤。');
  }
  const assets = new Map(catalog.assets.map((entry) => [assetKey(entry.id, entry.version), entry]));
  const loader = new GLTFLoader();
  const free = experiment.circuit && new URLSearchParams(location.search).get('mode') !== 'guided';
  const wanted = [...experiment.instruments, ...(free ? experiment.sandboxInstruments ?? [] : [])];
  const keys = [...new Set(wanted.map((item) => assetKey(item.assetId, item.assetVersion)))];
  const modelPairs = await Promise.all(keys.map(async (key) => {
    const asset = assets.get(key);
    if (!asset) throw new Error(`器材未登记：${key}`);
    try {
      const model = await loader.loadAsync(localUrl(asset.model).href);
      return [key, model.scene];
    } catch {
      throw new Error(`无法加载器材：${asset.title}`);
    }
  }));
  try {
    if (free) {
      const { startSandbox } = await import('./sandbox.js');
      startSandbox({ experiment, assets, models: new Map(modelPairs), localUrl, player, canvas, feedback: textFeedback });
    } else start(experiment, assets, new Map(modelPairs));
  } catch (error) {
    if (/WebGL/i.test(error.message)) throw new Error('此浏览器无法开启 WebGL。');
    throw error;
  }
}

window.lucide?.createIcons();
load().catch((error) => {
  status.textContent = error.message;
  player.dataset.ready = 'error';
}).finally(() => window.lucide?.createIcons());
