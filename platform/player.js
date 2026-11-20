import * as T from 'three';
import { GLTFLoader } from '../vendor/three-r160/loaders/GLTFLoader.js';

const byId = (id) => document.getElementById(id);
const root = new URL('../', import.meta.url);
const player = byId('player');
const canvas = byId('scene');
const target = byId('target');
const status = byId('load-status');
const feedback = byId('feedback');
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
  feedback.textContent = message;
  feedback.dataset.state = state;
  feedback.hidden = !message;
}

function start(experiment, assetCatalog, modelByAsset) {
  const renderer = new T.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.7));
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(38, 1, 0.01, 100);
  scene.background = new T.Color('#edf2f4');
  scene.add(new T.HemisphereLight(0xf9fcff, 0x808376, 2.1));
  const key = new T.DirectionalLight(0xfff5e5, 2.1);
  key.position.set(2, 4, 3);
  scene.add(key);
  const rim = new T.DirectionalLight(0xd0e4f0, 1.25);
  rim.position.set(-2, 2, -3);
  scene.add(rim);

  const table = new T.Group();
  scene.add(table);
  const models = new Map();
  const assetCounts = new Map();
  const titleCounts = new Map();
  const bounds = new T.Box3();
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
    group.add(modelByAsset.get(key).clone(true));
    table.add(group);
    group.updateMatrixWorld(true);
    bounds.union(new T.Box3().setFromObject(group));

    const displayNumber = (titleCounts.get(item.assetId) ?? 0) + 1;
    titleCounts.set(item.assetId, displayNumber);
    const baseLabel = assetCatalog.get(key).title;
    const label = assetCounts.get(item.assetId) > 1 ? `${baseLabel} ${displayNumber}` : baseLabel;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.instrumentId = item.id;
    button.setAttribute('aria-pressed', 'false');
    button.append(dataIcon('box'), label);
    button.addEventListener('click', () => selectInstrument(item.id));
    byId('instruments').append(button);
    models.set(item.id, { group, button, start: group.position.clone() });
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
    new T.MeshBasicMaterial({ color: '#edf2f4' })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(focus.x, tabletopY, focus.z);
  scene.add(ground);
  const grid = new T.GridHelper(extent * 8, 40, 0xd4dfe3, 0xdde6e9);
  grid.position.set(focus.x, tabletopY + extent * 0.001, focus.z);
  scene.add(grid);
  scene.fog = new T.Fog('#edf2f4', extent * 4, extent * 10);

  const outline = new T.Box3Helper(new T.Box3(), 0x208a70);
  outline.visible = false;
  scene.add(outline);
  const ray = new T.Raycaster();
  const point = new T.Vector2();
  const floor = new T.Plane(new T.Vector3(0, 1, 0));
  const targetPoint = new T.Vector3();
  const angle = new T.Spherical(1, 0.97, 0.52);
  const offset = new T.Vector3();
  let zoom = 1;
  let stepIndex = 0;
  let selected = null;
  let gesture = null;
  let demoFrame = null;
  const stepItems = experiment.steps.map((step, index) => {
    const li = document.createElement('li');
    li.dataset.stepId = step.id;
    const badge = document.createElement('span');
    badge.className = 'step-number';
    badge.setAttribute('aria-hidden', 'true');
    badge.textContent = String(index + 1);
    const label = document.createElement('span');
    label.textContent = step.title;
    li.append(badge, label);
    byId('step-list').append(li);
    return li;
  });

  const active = () => experiment.steps[stepIndex];
  const locked = () => demoFrame !== null;

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
      target.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    }
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    renderer.setSize(rect.width, rect.height, false);
    updateView();
  }

  function setSelection(id = null) {
    selected = id;
    for (const [key, model] of models) model.button.setAttribute('aria-pressed', String(key === id));
    updateView();
  }

  function renderSteps() {
    stepItems.forEach((item, index) => {
      if (index === stepIndex) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
      item.classList.toggle('is-complete', index < stepIndex);
    });
    byId('progress').textContent = `${stepIndex} / ${stepItems.length}`;
    byId('instruction').textContent = active()?.instruction ?? '实验步骤已完成。';
    player.dataset.stepIndex = String(stepIndex);
    player.dataset.complete = String(!active());
    demoButton.disabled = !active() || locked();
    target.disabled = locked();
    for (const model of models.values()) model.button.disabled = !active() || locked();
    setSelection();
  }

  function completeStep() {
    const step = active();
    if (!step) return;
    textFeedback(step.observable || '完成当前步骤。');
    stepIndex++;
    renderSteps();
  }

  function wrong() {
    const step = active();
    if (!step) return;
    setSelection();
    textFeedback(step.wrongFeedback || '请按当前步骤操作。', 'wrong');
  }

  function selectInstrument(id) {
    const action = active()?.action;
    if (!action || locked()) return;
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

  function reset() {
    if (demoFrame !== null) cancelAnimationFrame(demoFrame);
    demoFrame = null;
    cancelGesture();
    for (const model of models.values()) model.group.position.copy(model.start);
    textFeedback('');
    stepIndex = 0;
    renderSteps();
  }

  function demonstrate() {
    const action = active()?.action;
    if (!action || locked() || gesture) return;
    if (action.type === 'select') return selectInstrument(action.instrumentId);
    const model = models.get(action.instrumentId);
    const start = model.group.position.clone();
    const destination = new T.Vector3().fromArray(action.position);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return moveTo(action.instrumentId);
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
    for (const entry of models.values()) entry.button.disabled = true;
    setSelection(action.instrumentId);
  }

  function rayAt(e) {
    const rect = canvas.getBoundingClientRect();
    point.set((e.clientX - rect.left) / rect.width * 2 - 1, 1 - (e.clientY - rect.top) / rect.height * 2);
    ray.setFromCamera(point, camera);
  }

  function hitInstrument(e) {
    rayAt(e);
    const hit = ray.intersectObjects(table.children, true)[0];
    if (!hit) return null;
    let object = hit.object;
    while (object && !object.userData.instrumentId) object = object.parent;
    return object?.userData.instrumentId ?? null;
  }

  function pointerDown(e) {
    if (e.button !== 0 || gesture) return;
    const action = active()?.action;
    const id = locked() || !action ? null : hitInstrument(e);
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
    if (gesture?.pointer !== e.pointerId) return;
    const { id, group, start, moved } = gesture;
    gesture = null;
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
  viewButtons[3].addEventListener('click', () => { angle.theta = 0.52; angle.phi = 0.97; zoom = 1; updateView(); });
  target.addEventListener('click', () => moveTo(selected));
  demoButton.addEventListener('click', demonstrate);
  resetButton.addEventListener('click', reset);

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  for (const button of [...viewButtons, resetButton]) button.disabled = false;
  byId('experiment-title').textContent = experiment.title;
  byId('experiment-summary').textContent = experiment.summary;
  document.title = `${experiment.title} · 化学实验室`;
  status.hidden = true;
  renderSteps();
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
  const keys = [...new Set(experiment.instruments.map((item) => assetKey(item.assetId, item.assetVersion)))];
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
    start(experiment, assets, new Map(modelPairs));
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
