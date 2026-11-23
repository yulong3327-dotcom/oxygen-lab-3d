import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { assets, fingerprints, init, publicCatalog, root, validate } from '../scripts/lab-core.mjs';
import { build } from '../scripts/lab.mjs';

const save = (name, data) => writeFileSync(name, JSON.stringify(data));

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'chemistry-lab-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(resolve(root, 'assets'), resolve(dir, 'assets'), { recursive: true });
  cpSync(resolve(root, 'experiments/stand-placement'), resolve(dir, 'experiments/stand-placement'), { recursive: true });
  mkdirSync(resolve(dir, 'platform'));
  cpSync(resolve(root, 'platform/player.html'), resolve(dir, 'platform/player.html'));
  cpSync(resolve(root, 'styles.css'), resolve(dir, 'styles.css'));
  return dir;
}

test('new workspace cannot replace an existing experiment and starts pending', t => {
  const dir = fixture(t);
  assert.throws(() => init('stand-placement', dir), /EEXIST/);
  assert.equal(init('new-experiment', dir).length, 3);
  assert.throws(() => validate('new-experiment', dir), /title and summary/);
  assert.throws(() => init('../external', dir), /lowercase id/);
});

test('public listing requires current reviews and an approved asset', t => {
  const dir = fixture(t);
  const id = 'stand-placement';
  const configPath = resolve(dir, `experiments/${id}/experiment.json`);
  save(resolve(dir, 'platform/catalog.json'), { schemaVersion: 1, projects: [{ id, title: 'Fixture', summary: 'Test only', kind: 'config', href: `./player.html?id=${id}` }] });
  assert.throws(() => publicCatalog(dir), /current model, web and teaching approvals/);
  const versions = fingerprints(id, dir);
  save(resolve(dir, `experiments/${id}/review.json`), {
    schemaVersion: 1,
    ...Object.fromEntries(Object.entries(versions).map(([stage, fingerprint]) => [stage, [{ fingerprint, reviewer: 'test fixture', date: '2026-11-20', decision: 'approved', notes: 'simulated only' }]]))
  });
  assert.throws(() => publicCatalog(dir), /approved assets/);
  const catalog = assets(dir);
  catalog[0].status = 'approved';
  save(resolve(dir, 'assets/catalog.json'), { schemaVersion: 1, assets: catalog });
  assert.equal(publicCatalog(dir).projects.length, 1);
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.steps[0].instruction = 'Changed after approval';
  save(configPath, config);
  assert.deepEqual(validate(id, dir).reviews, { model: true, web: false, teaching: false });
  config.instruments[0].assetVersion = 999;
  save(configPath, config);
  assert.throws(() => validate(id, dir), /invalid assetId, assetVersion/);
});

test('state effects reference declared states and unique GLB nodes', t => {
  const dir = fixture(t);
  const id = 'stand-placement';
  const path = resolve(dir, `experiments/${id}/experiment.json`);
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.instruments.push({
    ...config.instruments[0], id: 'display-stand', interactive: false,
    states: { exposed: ['Upright'], hidden: [] }, initialState: 'exposed',
    animations: { Upright: { type: 'pulse', periodMs: 800, scale: [1, 1.1, 1] } }
  });
  const step = config.steps[0];
  step.effects = [{ instrumentId: 'display-stand', state: 'hidden' }];
  save(path, config);
  assert.equal(validate(id, dir).steps, 2);

  step.effects[0].state = 'unknown';
  save(path, config);
  assert.throws(() => validate(id, dir), /invalid or duplicate state effect/);
  step.effects[0].state = 'hidden';
  config.instruments[1].states.hidden = ['Nonexistent'];
  save(path, config);
  assert.throws(() => validate(id, dir), /GLB node Nonexistent must exist exactly once/);
  config.instruments[1].states.hidden = [];
  step.action.instrumentId = 'display-stand';
  save(path, config);
  assert.throws(() => validate(id, dir), /invalid action or instrument reference/);
});

test('guided assembly and procedure reject invalid locations and chronology', t => {
  const dir = fixture(t);
  const id = 'stand-placement';
  const path = resolve(dir, `experiments/${id}/experiment.json`);
  const config = JSON.parse(readFileSync(path, 'utf8'));
  const ref = { instrumentId: 'stand-1', anchor: 'clamp' };
  config.instruments.push({ ...config.instruments[0], id: 'stand-2' });
  config.assembly = [
    { instrumentId: 'stand-1', hint: 'Place the first stand', area: [0.03, 0.015] },
    { instrumentId: 'stand-2', hint: 'Attach the second stand', anchor: 'base', parent: 'stand-1' }
  ];
  config.steps[0].action = { type: 'transfer', from: ref, to: { instrumentId: 'stand-2', at: [0, 0, 0] }, fromLabel: 'Holder', toLabel: 'Base' };
  config.steps[1].action = { type: 'observe', durationMs: 1200 };
  config.parts = [{ ...ref, label: 'Clamp', detail: 'Holds the tube.' }];
  config.conclusion = 'Observed the assembled stands.';
  save(path, config);
  assert.equal(validate(id, dir).steps, 2);

  const reject = (change, pattern) => {
    const bad = structuredClone(config);
    change(bad);
    save(path, bad);
    assert.throws(() => validate(id, dir), pattern);
  };
  reject(bad => bad.assembly.pop(), /assembly must list every instrument once/);
  reject(bad => bad.assembly.reverse(), /parent must be an earlier slot/);
  reject(bad => { bad.assembly[0].area = [0.02, -0.01]; }, /invalid assembly area/);
  reject(bad => { bad.steps[0].action.to = { instrumentId: 'stand-2', anchor: 'unknown' }; }, /invalid transfer endpoint/);
  reject(bad => { bad.steps[1].action.durationMs = 0; }, /observe durationMs/);
  reject(bad => { bad.parts[0].instrumentId = 'unknown'; }, /invalid completion part/);
});

test('shared styles invalidate web and teaching fingerprints', t => {
  const dir = fixture(t);
  const original = fingerprints('stand-placement', dir);
  writeFileSync(resolve(dir, 'styles.css'), 'body { margin: 1px; }');
  const changed = fingerprints('stand-placement', dir);
  assert.equal(changed.model, original.model);
  assert.notEqual(changed.web, original.web);
  assert.notEqual(changed.teaching, original.teaching);
});

test('release package excludes drafts, review files and unapproved asset sources', () => {
  const dir = build();
  assert(existsSync(resolve(dir, 'index.html')));
  assert(existsSync(resolve(dir, 'platform/index.html')));
  assert(!existsSync(resolve(dir, 'experiments/stand-placement/experiment.json')));
  assert(!existsSync(resolve(dir, 'experiments/stand-placement/review.json')));
  assert(!existsSync(resolve(dir, 'assets/stand/v1/stand.blend')));
  assert(!existsSync(resolve(dir, 'assets/stand/v1/stand.glb')));
});

test('MCP client can query the same reusable asset and draft validation as the CLI', async t => {
  const client = new Client({ name: 'workflow-tests', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve(root, 'scripts/lab-mcp.mjs')], stderr: 'pipe' }));
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(x => x.name).sort(), ['list_assets', 'review_fingerprints', 'validate_experiment']);
  const result = await client.callTool({ name: 'list_assets', arguments: { query: 'stand' } });
  assert.equal(result.structuredContent.assets[0].id, 'stand');
  const review = await client.callTool({ name: 'validate_experiment', arguments: { id: 'stand-placement' } });
  assert.deepEqual(review.structuredContent.reviews, { model: false, web: false, teaching: false });
});
