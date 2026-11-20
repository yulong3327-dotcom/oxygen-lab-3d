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
