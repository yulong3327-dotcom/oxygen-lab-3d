import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CIRCUIT_PHASES, CIRCUIT_TERMINALS } from '../platform/circuit-model.js';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const vec = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const filled = value => typeof value === 'string' && value.trim().length > 0;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const stages = ['model', 'web', 'teaching'];
const hasId = value => typeof value === 'string' && slug.test(value);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isArea = value => Array.isArray(value) && value.length === 2 && value.every(n => Number.isFinite(n) && n > 0);
const nodeName = value => typeof value === 'string' && /^[a-zA-Z0-9_-]+$/.test(value);
const tuples = values => values.map(x => [x.id, x]);
export const assetKey = (id, version) => `${id}@${version}`;

function unique(items, name) {
  assert(Array.isArray(items), `${name}: expected an array`);
  const ids = new Set();
  for (const item of items) {
    assert(hasId(item?.id), `${name}: invalid id`);
    assert(!ids.has(item.id), `${name}: duplicate id ${item.id}`);
    ids.add(item.id);
  }
}

export function localPath(path, base = root) {
  assert(typeof path === 'string' && /^[a-zA-Z0-9._/-]+$/.test(path) && !path.split('/').some(x => !x || x === '..' || x === '.'), `Invalid repository path: ${path}`);
  const target = resolve(base, path);
  if (existsSync(target)) {
    const rel = relative(realpathSync(base), realpathSync(target));
    assert(rel !== '..' && !rel.startsWith(`..${sep}`), `Path leaves repository: ${path}`);
  }
  return target;
}

export function readJson(path, base = root) {
  return JSON.parse(readFileSync(localPath(path, base), 'utf8'));
}

function readVersion(path, base) {
  const data = readJson(path, base);
  assert(data?.schemaVersion === 1, `${path}: schemaVersion must be 1`);
  return data;
}

function file(path, base) {
  const target = localPath(path, base);
  assert(existsSync(target) && statSync(target).isFile() && statSync(target).size > 0, `Missing or empty file: ${path}`);
  return target;
}

export function assets(base = root) {
  const catalog = readVersion('assets/catalog.json', base).assets;
  assert(Array.isArray(catalog), 'assets: expected an array');
  const keys = new Set();
  for (const entry of catalog) {
    assert(hasId(entry?.id) && filled(entry.title) && Number.isInteger(entry.version) && entry.version > 0 && ['candidate', 'approved'].includes(entry.status) && filled(entry.provenance), `${entry?.id}: invalid asset metadata`);
    const key = assetKey(entry.id, entry.version);
    assert(!keys.has(key), `Duplicate asset: ${key}`);
    keys.add(key);
    for (const [key, extension] of [['model', '.glb'], ['source', '.blend'], ['preview', '.png']]) {
      const path = entry[key];
      assert(typeof path === 'string' && path.startsWith(`assets/${entry.id}/v${entry.version}/`) && path.endsWith(extension), `${entry.id}: invalid ${key} path`);
      file(path, base);
    }
    const glb = readFileSync(localPath(entry.model, base));
    assert(glb.length >= 20 && glb.toString('ascii', 0, 4) === 'glTF' && glb.readUInt32LE(4) === 2 && glb.readUInt32LE(8) === glb.length, `${entry.id}: invalid GLB 2 header`);
    assert(entry.anchors && !Array.isArray(entry.anchors) && Object.keys(entry.anchors).length > 0 && Object.entries(entry.anchors).every(([name, value]) => hasId(name) && vec(value)), `${entry.id}: invalid anchors; expected xyz vectors in metres`);
  }
  return catalog;
}

function modelNodeNames(path, base) {
  const buffer = readFileSync(localPath(path, base));
  const length = buffer.readUInt32LE(12);
  assert(buffer.toString('ascii', 16, 20) === 'JSON' && buffer.length >= length + 20, `${path}: invalid GLB JSON chunk`);
  const gltf = JSON.parse(buffer.toString('utf8', 20, 20 + length));
  const counts = new Map();
  for (const node of gltf.nodes ?? []) counts.set(node.name, (counts.get(node.name) ?? 0) + 1);
  return counts;
}

export function experiment(id, base = root, assetCatalog = assets(base)) {
  assert(hasId(id), `Invalid experiment id: ${id}`);
  const path = `experiments/${id}/experiment.json`;
  const data = readVersion(path, base);
  assert(data.id === id && filled(data.title) && filled(data.summary), `${id}: id, title and summary are required`);
  for (const field of ['equation', 'note', 'conclusion']) {
    assert(data[field] === undefined || filled(data[field]), `${id}: invalid ${field}`);
  }
  if (data.view !== undefined) {
    assert(isRecord(data.view) && Number.isFinite(data.view.theta) && Number.isFinite(data.view.phi) && data.view.phi >= 0.22 && data.view.phi <= 1.46, `${id}: invalid view angles`);
    const { zoom } = data.view;
    assert(zoom === undefined || (Number.isFinite(zoom) && zoom >= 0.65 && zoom <= 1.5), `${id}: invalid view zoom`);
  }
  unique(data.instruments, `${id}/instruments`);
  unique(data.steps, `${id}/steps`);
  assert(data.instruments.length && data.steps.length, `${id}: add at least one instrument and step`);
  const byAsset = new Map(assetCatalog.map(a => [assetKey(a.id, a.version), a]));
  const nodeCountsByAsset = new Map();
  for (const x of data.instruments) {
    const key = assetKey(x.assetId, x.assetVersion);
    const context = `${id}/${x.id}`;
    assert(hasId(x.assetId) && Number.isInteger(x.assetVersion) && byAsset.has(key) && vec(x.position) && (x.rotationY === undefined || Number.isFinite(x.rotationY)), `${context}: invalid assetId, assetVersion, position or rotationY`);
    assert(x.label === undefined || filled(x.label), `${context}: invalid label`);
    assert(x.interactive === undefined || typeof x.interactive === 'boolean', `${context}: invalid interactive flag`);
    if (x.states === undefined && x.initialState === undefined && x.animations === undefined) continue;
    assert(isRecord(x.states) && hasId(x.initialState) && Object.hasOwn(x.states, x.initialState), `${context}: invalid states or initialState`);
    const usedNodes = new Set();
    for (const [name, state] of Object.entries(x.states)) {
      assert(hasId(name) && Array.isArray(state) && state.every(nodeName) && new Set(state).size === state.length, `${context}: invalid state ${name}`);
      for (const node of state) usedNodes.add(node);
    }
    if (x.animations !== undefined) {
      assert(isRecord(x.animations), `${context}: invalid animations`);
      for (const [name, animation] of Object.entries(x.animations)) {
        assert(usedNodes.has(name) && isRecord(animation) && ['pulse', 'rise'].includes(animation.type) && Number.isFinite(animation.periodMs) && animation.periodMs >= 200 && animation.periodMs <= 10000, `${context}: invalid animation for ${name}`);
        if (animation.type === 'pulse') {
          assert(vec(animation.scale) && animation.scale.every(scale => scale >= 0.5 && scale <= 1.5), `${context}: invalid pulse scale for ${name}`);
        } else {
          assert(vec(animation.offset), `${context}: invalid rise offset for ${name}`);
        }
        assert(animation.phase === undefined || (Number.isFinite(animation.phase) && animation.phase >= 0 && animation.phase < 1), `${context}: invalid animation phase for ${name}`);
      }
    }
    if (usedNodes.size) {
      if (!nodeCountsByAsset.has(key)) nodeCountsByAsset.set(key, modelNodeNames(byAsset.get(key).model, base));
      const counts = nodeCountsByAsset.get(key);
      for (const name of usedNodes) assert(counts.get(name) === 1, `${context}: GLB node ${name} must exist exactly once`);
    }
  }
  const instruments = new Map(tuples(data.instruments));
  if (data.sandboxInstruments !== undefined) {
    assert(isRecord(data.circuit), id + ': sandbox requires a circuit');
    unique(data.sandboxInstruments, id + '/sandboxInstruments');
    for (const item of data.sandboxInstruments) {
      const context = id + '/sandbox/' + item.id;
      const key = assetKey(item.assetId, item.assetVersion);
      const asset = byAsset.get(key);
      assert(!instruments.has(item.id) && filled(item.label) && filled(item.category) && asset, context + ': invalid sandbox asset');
      assert(isRecord(item.ports) && Object.hasOwn(item.ports, 'p') && Object.hasOwn(item.ports, 'n')
        && Object.entries(item.ports).every(([port, label]) => hasId(port) && filled(label) && Object.hasOwn(asset.anchors, port)), context + ': missing port anchors');
      if (item.part !== undefined) {
        assert(isRecord(item.part), context + ': invalid moving parts');
        if (!nodeCountsByAsset.has(key)) nodeCountsByAsset.set(key, modelNodeNames(asset.model, base));
        for (const name of [item.part.node, item.part.glow, item.part.actuator]) {
          if (name !== undefined) assert(nodeName(name) && nodeCountsByAsset.get(key).get(name) === 1, context + ': missing or duplicate GLB node ' + name);
        }
      }
    }
  }
  const instrumentAsset = instrument => byAsset.get(assetKey(instrument.assetId, instrument.assetVersion));
  const hasAnchor = (instrument, value) => hasId(value) && Object.hasOwn(instrumentAsset(instrument).anchors, value);
  const location = ref => {
    if (!isRecord(ref) || !instruments.has(ref.instrumentId)) return false;
    if (ref.at !== undefined) return ref.anchor === undefined && vec(ref.at);
    return hasAnchor(instruments.get(ref.instrumentId), ref.anchor);
  };
  const guided = data.assembly !== undefined;
  if (guided) {
    assert(Array.isArray(data.assembly) && data.assembly.length === instruments.size, `${id}: assembly must list every instrument once`);
    const installed = new Set();
    for (const entry of data.assembly) {
      const instrument = instruments.get(entry?.instrumentId);
      assert(instrument && !installed.has(entry.instrumentId), `${id}: invalid or duplicate assembly instrument`);
      const context = `${id}/assembly/${entry.instrumentId}`;
      assert(filled(entry.hint) && (entry.label === undefined || filled(entry.label)), `${context}: invalid assembly hint or label`);
      assert(entry.anchor === undefined || vec(entry.anchor) || hasAnchor(instrument, entry.anchor), `${context}: invalid assembly anchor`);
      assert(entry.area === undefined || isArea(entry.area), `${context}: invalid assembly area`);
      assert(entry.parent === undefined || (entry.area === undefined && installed.has(entry.parent)), `${context}: parent must be an earlier slot and cannot be used with an area`);
      installed.add(entry.instrumentId);
    }
  }
  if (data.parts !== undefined) {
    assert(Array.isArray(data.parts) && data.parts.every(part => location(part) && filled(part.label) && filled(part.detail)), `${id}: invalid completion part or anchor`);
  }
  if (data.circuit !== undefined) {
    const c = data.circuit;
    assert(guided && isRecord(c) && data.steps.length === CIRCUIT_PHASES.length
      && data.steps.every((step, i) => step.action?.type === CIRCUIT_PHASES[i]), id + ': invalid circuit step sequence');
    assert(c.wireCount === 7 && Number.isInteger(c.samples) && c.samples >= 3 && c.samples <= 6
      && Number.isFinite(c.minVoltageGap) && c.minVoltageGap > 0 && c.minVoltageGap <= .5
      && Number.isFinite(c.sliderInitial) && c.sliderInitial > 0 && c.sliderInitial < 1, id + ': invalid circuit measurement settings');
    assert(isRecord(c.terminals) && Object.keys(c.terminals).length === CIRCUIT_TERMINALS.length
      && CIRCUIT_TERMINALS.every(key => {
        const value = c.terminals[key];
        return isRecord(value) && location({ instrumentId: key.split(':')[0], anchor: value.anchor })
          && filled(value.mark) && filled(value.label);
      }), id + ': invalid circuit terminal or anchor');
    assert(isRecord(c.parts), id + ': missing circuit model parts');
    for (const [role, instrumentId] of Object.entries({ switch: 'switch', slider: 'rheostat', ammeter: 'ammeter', voltmeter: 'voltmeter' })) {
      const part = c.parts[role];
      const context = id + '/circuit/' + role;
      assert(part?.instrumentId === instrumentId && instruments.has(instrumentId) && nodeName(part.node), context + ': invalid moving part');
      const key = assetKey(instruments.get(instrumentId).assetId, instruments.get(instrumentId).assetVersion);
      if (!nodeCountsByAsset.has(key)) nodeCountsByAsset.set(key, modelNodeNames(byAsset.get(key).model, base));
      assert(nodeCountsByAsset.get(key).get(part.node) === 1, context + ': moving node must exist exactly once');
      if (role === 'slider') {
        const position = part.position;
        assert(!part.rotate && position && ['x', 'y', 'z'].includes(position.axis) && Number.isFinite(position.min)
          && Number.isFinite(position.max) && position.max > position.min
          && Array.isArray(part.rail) && part.rail.length === 2 && part.rail.every(vec), context + ': invalid slider travel');
      } else {
        assert(!part.position && vec(part.rotate?.axis) && Math.abs(Math.hypot(...part.rotate.axis) - 1) < 1e-5
          && Number.isFinite(part.rotate.arc), context + ': invalid rotation');
        if (role === 'switch') assert(part.marker?.instrumentId === instrumentId && location(part.marker), context + ': invalid switch marker');
      }
    }
  }
  for (const s of data.steps) {
    const a = s.action;
    const context = `${id}/${s.id}`;
    assert([s.title, s.instruction, s.observable, s.wrongFeedback].every(filled), `${context}: title, instruction, observable and wrongFeedback are required`);
    if (data.circuit !== undefined) {
      assert(CIRCUIT_PHASES.includes(a?.type) && s.effects === undefined, context + ': invalid circuit action');
    } else if (guided) {
      assert(a && ['transfer', 'observe'].includes(a.type), `${context}: guided experiments require transfer or observe`);
      if (a.type === 'transfer') {
        assert([a.from, a.to].every(ref => vec(ref) || location(ref)) && filled(a.fromLabel) && filled(a.toLabel), `${context}: invalid transfer endpoint, anchor or label`);
      } else {
        assert(Number.isInteger(a.durationMs) && a.durationMs >= 100 && a.durationMs <= 30000, `${context}: observe durationMs must be between 100 and 30000`);
      }
    } else {
      assert(a && ['select', 'move-to'].includes(a.type) && instruments.has(a.instrumentId) && instruments.get(a.instrumentId).interactive !== false, `${context}: invalid action or instrument reference`);
      if (a.type === 'move-to') assert(vec(a.position), `${context}: move-to requires a position vector`);
    }
    if (s.effects !== undefined) {
      assert(Array.isArray(s.effects), `${context}: effects must be an array`);
      const changed = new Set();
      for (const effect of s.effects) {
        const config = instruments.get(effect?.instrumentId);
        assert(config?.states && hasId(effect.state) && Object.hasOwn(config.states, effect.state) && !changed.has(effect.instrumentId), `${context}: invalid or duplicate state effect`);
        changed.add(effect.instrumentId);
      }
    }
  }
  return data;
}

function hashFiles(files, base) {
  const hash = createHash('sha256');
  for (const path of [...new Set(files)].sort()) {
    hash.update(path).update('\0').update(createHash('sha256').update(readFileSync(file(path, base))).digest());
  }
  return hash.digest('hex');
}

const experimentAssets = data => [...new Set([...data.instruments, ...(data.sandboxInstruments ?? [])].map(x => assetKey(x.assetId, x.assetVersion)))];

export function fingerprints(id, base = root, catalog = assets(base)) {
  const data = experiment(id, base, catalog);
  const used = new Set(experimentAssets(data));
  const entries = catalog.filter(x => used.has(assetKey(x.id, x.version))).sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version);
  const metadataHash = createHash('sha256').update(JSON.stringify(entries.map(({ status, ...entry }) => entry))).digest('hex');
  const modelFiles = entries.flatMap(x => [x.source, x.model, x.preview]);
  const playerFiles = readdirSync(localPath('platform', base), { recursive: true, withFileTypes: true })
    .filter(x => x.isFile() && /\.(html|css|m?js)$/.test(x.name) && !/^index\./.test(x.name))
    .map(x => relative(base, resolve(x.parentPath, x.name)).split(sep).join('/'));
  const model = createHash('sha256').update(metadataHash).update(hashFiles(modelFiles, base)).digest('hex');
  const web = createHash('sha256').update(model).update(hashFiles([`experiments/${id}/experiment.json`, 'styles.css', ...playerFiles], base)).digest('hex');
  const teaching = createHash('sha256').update(web).update(hashFiles([`experiments/${id}/intake.md`], base)).digest('hex');
  return { model, web, teaching };
}

function approvalStatus(id, base, catalog) {
  const data = readVersion(`experiments/${id}/review.json`, base);
  const current = fingerprints(id, base, catalog);
  return Object.fromEntries(stages.map(stage => {
    const records = data[stage];
    assert(Array.isArray(records), `${id}/review: ${stage} must be an array`);
    for (const r of records) {
      assert(['approved', 'changes-requested'].includes(r?.decision) && filled(r.reviewer) && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && /^[0-9a-f]{64}$/.test(r.fingerprint) && filled(r.notes), `${id}/review: invalid ${stage} record`);
    }
    const last = records.at(-1);
    return [stage, last?.fingerprint === current[stage] && last?.decision === 'approved'];
  }));
}

export function validate(id, base = root) {
  const catalog = assets(base);
  const data = experiment(id, base, catalog);
  file(`experiments/${id}/intake.md`, base);
  return { id, steps: data.steps.length, assets: experimentAssets(data), reviews: approvalStatus(id, base, catalog) };
}

export function publicCatalog(base = root) {
  const data = readVersion('platform/catalog.json', base);
  unique(data.projects, 'public projects');
  for (const p of data.projects) {
    assert(filled(p.title) && filled(p.summary), `${p.id}: missing title or summary`);
    if (p.thumbnail !== undefined) {
      assert(typeof p.thumbnail === 'string' && p.thumbnail.startsWith('assets/') && p.thumbnail.endsWith('.png'), `${p.id}: invalid thumbnail`);
      file(p.thumbnail, base);
    }
    if (p.kind === 'legacy') {
      assert(p.id === 'oxygen-lab' && p.href === '../', `${p.id}: only the existing oxygen-lab is a legacy project`);
    } else {
      assert(p.kind === 'config' && p.href === `./player.html?id=${p.id}`, `${p.id}: invalid project kind or href`);
      const result = validate(p.id, base);
      assert(Object.values(result.reviews).every(Boolean), `${p.id}: publication requires current model, web and teaching approvals`);
      assert(assets(base).filter(a => result.assets.includes(assetKey(a.id, a.version))).every(a => a.status === 'approved'), `${p.id}: publication requires approved assets`);
    }
  }
  return data;
}

export function init(id, base = root) {
  assert(hasId(id) && id !== 'oxygen-lab', `Use a new lowercase id with hyphens: ${id}`);
  const dir = localPath(`experiments/${id}`, base);
  mkdirSync(dirname(dir), { recursive: true });
  mkdirSync(dir);
  const paths = ['intake.md', 'experiment.json', 'review.json'];
  writeFileSync(resolve(dir, 'intake.md'), '# 实验任务单\n\n- 教材来源、受众和教学目标：\n- 器材、规格和参考图（标注来源和授权）：\n- 步骤、完成条件、错误反馈和可观察现象：\n- 需要用户确认的事项：\n- 器材复用和新增清单：\n');
  writeFileSync(resolve(dir, 'experiment.json'), `${JSON.stringify({ schemaVersion: 1, id, title: id, summary: '', instruments: [], steps: [] }, null, 2)}\n`);
  writeFileSync(resolve(dir, 'review.json'), `${JSON.stringify({ schemaVersion: 1, model: [], web: [], teaching: [] }, null, 2)}\n`);
  return paths.map(x => `experiments/${id}/${x}`);
}
