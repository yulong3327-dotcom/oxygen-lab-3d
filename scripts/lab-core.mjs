import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const vec = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const filled = value => typeof value === 'string' && value.trim().length > 0;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const stages = ['model', 'web', 'teaching'];
const hasId = value => typeof value === 'string' && slug.test(value);
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

export function experiment(id, base = root, assetCatalog = assets(base)) {
  assert(hasId(id), `Invalid experiment id: ${id}`);
  const path = `experiments/${id}/experiment.json`;
  const data = readVersion(path, base);
  assert(data.id === id && filled(data.title) && filled(data.summary), `${id}: id, title and summary are required`);
  unique(data.instruments, `${id}/instruments`);
  unique(data.steps, `${id}/steps`);
  assert(data.instruments.length && data.steps.length, `${id}: add at least one instrument and step`);
  const byAsset = new Map(assetCatalog.map(a => [assetKey(a.id, a.version), a]));
  for (const x of data.instruments) {
    assert(hasId(x.assetId) && Number.isInteger(x.assetVersion) && byAsset.has(assetKey(x.assetId, x.assetVersion)) && vec(x.position) && (x.rotationY === undefined || Number.isFinite(x.rotationY)), `${id}/${x.id}: invalid assetId, assetVersion, position or rotationY`);
  }
  const instruments = new Map(tuples(data.instruments));
  for (const s of data.steps) {
    const a = s.action;
    assert([s.title, s.instruction, s.observable, s.wrongFeedback].every(filled), `${id}/${s.id}: title, instruction, observable and wrongFeedback are required`);
    assert(a && ['select', 'move-to'].includes(a.type) && instruments.has(a.instrumentId), `${id}/${s.id}: invalid action or instrument reference`);
    if (a.type === 'move-to') assert(vec(a.position), `${id}/${s.id}: move-to requires a position vector`);
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

export function fingerprints(id, base = root, catalog = assets(base)) {
  const data = experiment(id, base, catalog);
  const used = new Set(data.instruments.map(x => assetKey(x.assetId, x.assetVersion)));
  const entries = catalog.filter(x => used.has(assetKey(x.id, x.version))).sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version);
  const metadataHash = createHash('sha256').update(JSON.stringify(entries.map(({ status, ...entry }) => entry))).digest('hex');
  const modelFiles = entries.flatMap(x => [x.source, x.model, x.preview]);
  const playerFiles = readdirSync(localPath('platform', base), { recursive: true, withFileTypes: true })
    .filter(x => x.isFile() && /\.(html|css|m?js)$/.test(x.name) && !/^index\./.test(x.name))
    .map(x => relative(base, resolve(x.parentPath, x.name)).split(sep).join('/'));
  const model = createHash('sha256').update(metadataHash).update(hashFiles(modelFiles, base)).digest('hex');
  const web = createHash('sha256').update(model).update(hashFiles([`experiments/${id}/experiment.json`, ...playerFiles], base)).digest('hex');
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
  return { id, steps: data.steps.length, assets: [...new Set(data.instruments.map(x => assetKey(x.assetId, x.assetVersion)))], reviews: approvalStatus(id, base, catalog) };
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
